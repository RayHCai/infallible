"""Derive data/tasks/tasks.yaml and data/personas/personas.json from cleaned MAUDE reports.

extract: Haiku tags each user-error report (task, operator, contributing factors).
         Cached in data/maude/extracted.jsonl by narrative hash; resumable.
build:   rank tasks and operator profiles, then Opus writes the seed files.

Run: uv run --env-file .env python scripts/build_seed_data.py extract [--limit N]
     uv run --env-file .env python scripts/build_seed_data.py build
"""

import argparse
import ast
import hashlib
import json
import random
import re
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from enum import StrEnum
from pathlib import Path
from statistics import median
from typing import TYPE_CHECKING, Any, Literal
from uuid import NAMESPACE_URL, uuid5

import anthropic
from pydantic import BaseModel, Field

from infallible_contracts import FirmwareState, Persona, Task
from infallible_contracts.loaders import write_personas, write_tasks
from infallible_contracts.persona import ModifierId

if TYPE_CHECKING:
    from collections.abc import Iterator

DATA = Path(__file__).resolve().parents[1] / 'data'
CLEAN_DIR = DATA / 'maude' / 'cleaned'
CACHE = DATA / 'maude' / 'extracted.jsonl'

EXTRACT_MODEL = 'claude-haiku-4-5'
SYNTH_MODEL = 'claude-opus-5-5'
N_TASKS, N_PERSONAS, N_SAMPLES = 5, 4, 40

USER_ERROR = re.compile(
    r'improper or incorrect procedure|use of device|human|user interface|training'
    r'|instructions|misassembly|method, improper',
    re.IGNORECASE,
)
AGE = re.compile(r'(\d+)\s*YR')


class TaskKind(StrEnum):
    BOLUS = 'bolus_delivery'
    BASAL = 'basal_or_temp_basal_programming'
    SUSPEND_RESUME = 'suspend_or_resume_delivery'
    RESERVOIR = 'reservoir_or_cartridge_fill_or_change'
    INFUSION_SITE = 'infusion_set_or_pod_change'
    CGM = 'cgm_sensor_or_pairing'
    ALARM = 'responding_to_alarm_or_alert'
    BATTERY = 'battery_or_charging'
    SETTINGS = 'settings_or_time_configuration'
    SOFTWARE = 'software_update_or_app'
    OTHER = 'other'
    UNKNOWN = 'unknown'


class Operator(StrEnum):
    SELF = 'self'
    PARENT = 'parent'
    OTHER_CAREGIVER = 'other_caregiver'
    CLINICIAN = 'clinician'
    UNKNOWN = 'unknown'


class Factor(StrEnum):
    NEW_USER = 'new_user_or_insufficient_training'
    VISION = 'vision_impairment'
    COGNITIVE = 'cognitive_or_memory'
    DEXTERITY = 'dexterity_or_tremor'
    HEARING = 'hearing_impairment'
    ASLEEP = 'asleep_or_overnight'
    ACTIVITY = 'exercise_or_activity'
    SCHOOL = 'school_or_daycare'
    ILLNESS = 'illness'
    DISTRACTION = 'distracted_or_busy'
    MISREAD = 'misread_or_misunderstood_screen'
    MISSED_ALARM = 'ignored_or_missed_alarm'


class Extraction(BaseModel):
    user_error: bool = Field(description="True if the user's action or inaction contributed.")
    task: TaskKind = Field(description='What the user was doing when the problem occurred.')
    error: str = Field(description='The mistake in under 15 words, or "none".')
    operator: Operator = Field(description='Who was operating the pump.')
    factors: list[Factor] = Field(
        description='Circumstances the narrative explicitly names as contributing; usually empty.'
    )


EXTRACT_SYSTEM = (
    'You tag FDA MAUDE insulin pump adverse event reports. Use only what the narrative states; '
    'pick "unknown" rather than guessing. "parent" means a parent operated the pump for a child. '
    'Add a factor only when the text says it, e.g. "asleep" needs the user to have been asleep '
    'during the event, not just waking up to a high reading.'
)


def reports() -> Iterator[dict[str, Any]]:
    for f in sorted(CLEAN_DIR.glob('insulin_pumps_*.jsonl')):
        with f.open(encoding='utf-8') as fh:
            for line in fh:
                r = json.loads(line)
                if r['event_description'] and any(
                    USER_ERROR.search(p) for p in r['product_problems'] or []
                ):
                    yield r


def key(r: dict[str, Any]) -> str:
    return hashlib.sha1(r['event_description'].encode(), usedforsecurity=False).hexdigest()


def load_cache() -> dict[str, dict[str, Any]]:
    if not CACHE.exists():
        return {}
    with CACHE.open(encoding='utf-8') as fh:
        return {(e := json.loads(line))['key']: e for line in fh}


def extract_one(client: anthropic.Anthropic, r: dict[str, Any]) -> dict[str, Any]:
    problems = ', '.join(dict.fromkeys(r['product_problems']))
    resp = client.messages.parse(
        model=EXTRACT_MODEL,
        max_tokens=512,
        system=EXTRACT_SYSTEM,
        messages=[
            {
                'role': 'user',
                'content': f'Coded problems: {problems}\n\nNarrative:\n{r["event_description"]}',
            }
        ],
        output_format=Extraction,
    )
    if resp.parsed_output is None:
        raise RuntimeError(f'no parse for report {r["id"]}: {resp.stop_reason}')
    return {'key': key(r), **resp.parsed_output.model_dump(mode='json')}


def extract(limit: int | None) -> None:
    rows = list(reports())
    random.Random(0).shuffle(rows)  # noqa: S311
    cache = load_cache()
    todo = list({key(r): r for r in rows if key(r) not in cache}.values())[
        : None if limit is None else max(0, limit - len(cache))
    ]
    print(f'{len(rows):,} user-error reports, {len(cache):,} cached, {len(todo):,} to extract')

    client = anthropic.Anthropic(max_retries=8)
    failed = 0
    with CACHE.open('a', encoding='utf-8') as out, ThreadPoolExecutor(16) as pool:
        futures = [pool.submit(extract_one, client, r) for r in todo]
        for i, fut in enumerate(as_completed(futures), 1):
            try:
                out.write(json.dumps(fut.result()) + '\n')
            except anthropic.APIError, RuntimeError:
                failed += 1
            if i % 500 == 0 or i == len(futures):
                out.flush()
                print(f'{i:,}/{len(futures):,} done, {failed} failed')


# --------------------------------------------------------------------------- #
# build                                                                       #
# --------------------------------------------------------------------------- #

FIRMWARE = """\
The simulated pump is generic-pump-v1: buttons up, down, ok, back, menu; screens
home, menu (Bolus / Basal / Back), bolus_entry (up/down by 0.1 U, max 25),
bolus_confirm, delivering, basal_view (read-only), alarm (ok clears). Unconfirmed
bolus entry times out to home after 30 s and is silently discarded. Holding a
button auto-repeats after 600 ms. A low_reservoir alarm fires at <= 20 U.
Firmware state (for initial_state and success): screen, bolus_units (last
delivered), pending_bolus_units, basal_rate, reservoir_units, battery_pct, alarms.
initial_state accepts: screen, pending_bolus_units, bolus_units, basal_rate,
reservoir_units, battery_pct, alarms. success is a Python boolean expression over
those state names only (comparisons, and/or/not, `in`), e.g. "bolus_units == 2.5".
The emulator cannot model physical work (filling cartridges, inserting sets): turn
such scenarios into the on-screen step the user does around them."""


# Explicit fields: structured outputs drop free-form dict keys.
class InitialStateDraft(BaseModel):
    screen: Literal['home', 'menu', 'bolus_entry', 'basal_view', 'alarm'] | None
    pending_bolus_units: float | None
    bolus_units: float | None
    basal_rate: float | None
    reservoir_units: float | None
    battery_pct: int | None
    alarms: list[Literal['low_reservoir']] | None


class TaskDraft(BaseModel):
    name: str = Field(description='Short Title Case name, e.g. "Meal Bolus With Low Reservoir".')
    description: str = Field(description='What the user is trying to do, in their words.')
    goal: str = Field(description='Instruction given to the agent, with concrete values.')
    initial_state: InitialStateDraft = Field(
        description='Set every value the goal or success depends on; null keeps the default.'
    )
    success: str
    max_steps: int = Field(ge=5, le=100)


class ModifierDraft(BaseModel):
    id: ModifierId
    parameters: dict[str, float | str]


class PersonaDraft(BaseModel):
    name: str = Field(
        description='Short descriptive label, e.g. "Teen, self-managing". Not a personal name.'
    )
    description: str
    age: int = Field(description='Age of the person operating the pump.')
    gender: str
    guiding_prompt: str = Field(
        description='Second-person prompt describing how this person thinks and acts.'
    )
    modifiers: list[ModifierDraft]


# Baseline: separates design failures (everyone fails) from persona-specific ones.
CONTROL = Persona.model_validate(
    {
        'id': uuid5(NAMESPACE_URL, 'infallible:persona:control'),
        'name': 'Control (healthy adult)',
        'description': 'Healthy 25-year-old with good vision, hearing and dexterity. '
        'Experienced pump user.',
        'attributes': {
            'age': 25,
            'gender': 'unspecified',
            'guiding_prompt': 'You are a healthy 25-year-old who has used an insulin pump for '
            'years. You are rested and focused, read every screen fully, and check values '
            'before confirming.',
            'modifiers': [],
        },
    }
)


SYNTH_SYSTEM = (
    'Every field you write is read by an AI agent role-playing a pump user, as plain guidance. '
    'Never mention MAUDE, the FDA, reports, narratives, data, or statistics.'
)
SOURCE_LEAK = re.compile(r'maude|fda|\breports?\b|narrative', re.IGNORECASE)


def synth[T: BaseModel](client: anthropic.Anthropic, prompt: str, schema: type[T]) -> T:
    for _ in range(3):
        resp = client.messages.parse(
            model=SYNTH_MODEL,
            max_tokens=16000,
            system=SYNTH_SYSTEM,
            output_config={'effort': 'high'},
            messages=[{'role': 'user', 'content': prompt}],
            output_format=schema,
        )
        if resp.parsed_output is None:
            raise RuntimeError(f'synthesis failed: {resp.stop_reason}')
        if not SOURCE_LEAK.search(resp.parsed_output.model_dump_json()):
            return resp.parsed_output
    raise RuntimeError('synthesis kept mentioning the data source')


def check_predicate(expr: str) -> None:
    names = {n.id for n in ast.walk(ast.parse(expr, mode='eval')) if isinstance(n, ast.Name)}
    if unknown := names - set(FirmwareState.model_fields):
        raise ValueError(f'success {expr!r} uses unknown state {unknown}')


def age_bracket(age: int) -> str:
    return 'child' if age < 13 else 'teen' if age < 20 else 'adult' if age < 65 else 'older adult'


def narrative(r: dict[str, Any]) -> str:
    return f'[{r["patient_age"] or "?"} {r["patient_sex"] or "?"}] {r["event_description"]}'


def build() -> None:
    cache = load_cache()
    rows = [
        {**r, **cache[key(r)]} for r in reports() if key(r) in cache and cache[key(r)]['user_error']
    ]
    print(f'{len(rows):,} confirmed user-error reports')
    rng = random.Random(0)  # noqa: S311
    client = anthropic.Anthropic()

    by_task: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        if r['task'] not in (TaskKind.OTHER, TaskKind.UNKNOWN):
            by_task[r['task']].append(r)
    top_tasks = sorted(by_task, key=lambda t: -len(by_task[t]))[:N_TASKS]

    tasks = []
    for kind in top_tasks:
        group = by_task[kind]
        errors = Counter(r['error'] for r in group).most_common(15)
        sample = rng.sample(group, min(N_SAMPLES, len(group)))
        draft = synth(
            client,
            f'{FIRMWARE}\n\nWrite one usability-test task for the scenario "{kind}", seen in '
            f'{len(group):,} MAUDE user-error reports. Most common mistakes:\n'
            + '\n'.join(f'- {e} ({n})' for e, n in errors)
            + '\n\nSample narratives:\n'
            + '\n\n'.join(narrative(r) for r in sample)
            + '\n\nThe goal must be achievable on this firmware and give the agent room to '
            'make the most common mistake; success must catch that mistake.',
            TaskDraft,
        )
        check_predicate(draft.success)
        tasks.append(
            Task(
                id=uuid5(NAMESPACE_URL, f'infallible:task:{kind}'),
                **draft.model_dump(exclude={'initial_state'}),
                initial_state=draft.initial_state.model_dump(exclude_none=True),
            )
        )
        print(f'task {kind}: {len(group):,} reports -> {draft.name}')

    by_profile: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        m = AGE.match(r['patient_age'] or '')
        if not m or r['operator'] == Operator.UNKNOWN:
            continue
        factor = r['factors'][0] if r['factors'] else 'none_stated'
        by_profile[(age_bracket(int(m.group(1))), r['operator'], factor)].append(r)
    top_profiles = sorted(by_profile, key=lambda p: -len(by_profile[p]))[:N_PERSONAS]

    personas = [CONTROL]
    for profile in top_profiles:
        group = by_profile[profile]
        ages = [int(m.group(1)) for r in group if (m := AGE.match(r['patient_age']))]
        sexes = Counter(r['patient_sex'] for r in group if r['patient_sex'] in ('Male', 'Female'))
        factors = Counter(f for r in group for f in r['factors']).most_common(6)
        tasks_seen = Counter(r['task'] for r in group).most_common(5)
        sample = rng.sample(group, min(N_SAMPLES, len(group)))
        bracket, operator, factor = profile
        persona_draft = synth(
            client,
            f'Write one persona for usability-testing an insulin pump. Do not give the person '
            f'a personal name anywhere; its label must differ from {[p.name for p in personas]}. '
            f'Profile: patient age '
            f'bracket {bracket} (median {median(ages):.0f}), operator {operator}, main factor '
            f'{factor}; {len(group):,} MAUDE user-error reports. Patient sex where known: '
            f'{dict(sexes)}. Factors: {dict(factors)}. Tasks: {dict(tasks_seen)}.\n\n'
            'The persona is the person pressing the buttons (for a parent operator, the parent; '
            'estimate their age). Ground every trait in the narratives below; do not invent '
            'diagnoses they do not support. Modifiers are perception/motor degradations '
            f'({", ".join(ModifierId)}); add one only if the profile supports it, with numeric '
            'parameters (blur: sigma ~1-4; contrast_loss: factor 0-1; color_deficiency: kind; '
            'tremor: amplitude 0-1, chance a press slips; hearing_loss, neuropathy: severity '
            '0-1). The guiding_prompt should make the agent act as this person '
            'would, including their typical mistakes, not as an expert.\n\nSample narratives:\n'
            + '\n\n'.join(narrative(r) for r in sample),
            PersonaDraft,
        )
        personas.append(
            Persona.model_validate(
                {
                    'id': uuid5(NAMESPACE_URL, f'infallible:persona:{"/".join(profile)}'),
                    'name': persona_draft.name,
                    'description': persona_draft.description,
                    'attributes': {
                        'age': persona_draft.age,
                        'gender': persona_draft.gender,
                        'guiding_prompt': persona_draft.guiding_prompt,
                        'modifiers': [m.model_dump(mode='json') for m in persona_draft.modifiers],
                    },
                }
            )
        )
        print(f'persona {profile}: {len(group):,} reports -> {persona_draft.name}')

    write_tasks(DATA / 'tasks' / 'tasks.yaml', tasks)
    write_personas(DATA / 'personas' / 'personas.json', personas)


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='cmd', required=True)
    sub.add_parser('extract').add_argument('--limit', type=int)
    sub.add_parser('build')
    args = parser.parse_args()
    if args.cmd == 'extract':
        extract(args.limit)
    else:
        build()


if __name__ == '__main__':
    main()
