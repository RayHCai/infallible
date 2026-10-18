import type {
  MeshAnnotations,
  Persona,
  Suggestion,
  Task,
  TaskOutcome,
} from '@infallible/contracts';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import type { ActionRecord, AgentView } from '../state/runStore';
import { describeAction, poseAfter } from '../three/eyePose';
import type { Sandbox } from '../three/sandbox';
import { useSandbox } from '../three/useSandbox';
import { Pause, Play, StatusIcon } from '../ui/icons';
import { LiveFrame } from './LiveFrame';

export type SandboxMode =
  | { kind: 'live'; agentId: string }
  | { kind: 'replay'; agentId: string; taskId: string }
  | { kind: 'change'; suggestionId: string };

/** Remount key: switching suggestions keeps the same scene, so it is not part of it. */
export const modeKey = (m: SandboxMode) =>
  m.kind === 'change' ? 'change' : `${m.kind}:${m.agentId}:${m.kind === 'replay' ? m.taskId : ''}`;

interface Props {
  mode: SandboxMode;
  meshUrl: string | null;
  annotations: MeshAnnotations | null;
  agents: Record<string, AgentView>;
  personas: Map<string, Persona>;
  personaByAgent: Map<string, string>;
  tasks: Task[];
  suggestions: Suggestion[];
  /** False when the persona card already sits in the detail column. */
  showPersona: boolean;
  onOpenAgent: (agentId: string, taskId: string | null) => void;
}

type SandboxRef = RefObject<Sandbox | null>;
const NO_ACTIONS: ActionRecord[] = [];
const STEP_MS = 1100;

/** Live: follow the agent's newest action as it happens. */
function useLive(actions: ActionRecord[], sandboxRef: SandboxRef, enabled: boolean) {
  const seeded = useRef(false);
  useEffect(() => {
    const sb = sandboxRef.current;
    if (!enabled || !sb) return;
    sb.setPose(poseAfter(actions.map((a) => a.chosen)), !seeded.current);
    const last = actions[actions.length - 1];
    if (seeded.current && last) sb.play(last.chosen);
    seeded.current = true;
  }, [enabled, actions, sandboxRef]);
}

/** Replay: step through recorded actions on a timer or by scrubbing. */
function useReplay(actions: ActionRecord[], sandboxRef: SandboxRef, enabled: boolean) {
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(true);
  const prev = useRef(-1);
  const ended = cursor >= actions.length;

  useEffect(() => {
    if (!enabled || !playing || ended) return;
    const t = setInterval(() => {
      setCursor((c) => Math.min(actions.length, c + 1));
    }, STEP_MS);
    return () => {
      clearInterval(t);
    };
  }, [enabled, playing, ended, actions.length]);

  useEffect(() => {
    const sb = sandboxRef.current;
    if (!enabled || !sb) return;
    sb.setPose(
      poseAfter(
        actions.map((a) => a.chosen),
        cursor,
      ),
      prev.current < 0,
    );
    const stepped = prev.current >= 0 && cursor > prev.current;
    prev.current = cursor;
    const record = actions[cursor - 1];
    if (stepped && record) sb.play(record.chosen);
  }, [enabled, cursor, actions, sandboxRef]);

  const toggle = useCallback(() => {
    if (ended) {
      setCursor(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  }, [ended]);
  const scrub = useCallback((n: number) => {
    setPlaying(false);
    setCursor(n);
  }, []);

  return { cursor, playing, ended, toggle, scrub };
}

/** Change: show the proposed change and reveal "after" shortly after opening. */
function useChange(
  suggestion: Suggestion | null,
  sandboxRef: SandboxRef,
  annotations: MeshAnnotations | null,
) {
  // Stored per suggestion id so switching suggestions starts from "before" again.
  const [afterFor, setAfterFor] = useState<string | null>(null);
  const after = suggestion !== null && afterFor === suggestion.id;
  useEffect(() => {
    const sb = sandboxRef.current;
    if (!sb || !suggestion) return;
    sb.hideEye();
    sb.setChange(suggestion.proposed_change);
    const t = setTimeout(() => {
      setAfterFor(suggestion.id);
    }, 900);
    return () => {
      clearTimeout(t);
      sb.setChange(null);
    };
  }, [suggestion, sandboxRef, annotations]);
  useEffect(() => {
    sandboxRef.current?.setChangePhase(after ? 1 : 0);
  }, [after, sandboxRef]);
  const setAfter = useCallback(
    (v: boolean) => {
      setAfterFor(v && suggestion ? suggestion.id : null);
    },
    [suggestion],
  );
  return { after, setAfter };
}

const OUTCOME_LABEL: Record<TaskOutcome, string> = {
  passed: 'Passed',
  failed: 'Failed',
  errored: 'Errored',
};

function duration(actions: ActionRecord[]): string | null {
  const first = actions[0];
  const last = actions[actions.length - 1];
  if (!first || !last) return null;
  const s = Math.round((Date.parse(last.at) - Date.parse(first.at)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function Recap({
  outcome,
  actions,
  summary,
  reason,
}: {
  outcome: TaskOutcome;
  actions: ActionRecord[];
  summary: string | undefined;
  reason: string | null;
}) {
  const took = duration(actions);
  return (
    <div className={`recap ${outcome}`}>
      <div className="recap-head">
        <StatusIcon status={outcome} />
        <span className="k">{OUTCOME_LABEL[outcome]}</span>
        <span className="muted">
          {actions.length} {actions.length === 1 ? 'step' : 'steps'}
          {took && ` · ${took}`}
        </span>
      </div>
      {summary ? <p>{summary}</p> : <p className="muted">Summarizing…</p>}
      {reason && <p className="muted">{reason}</p>}
    </div>
  );
}

/** Column 4 of the browser: the 3D scene plus what the agent is doing in it. */
export function SandboxView(props: Props) {
  const {
    mode,
    meshUrl,
    annotations,
    agents,
    personas,
    personaByAgent,
    tasks,
    suggestions,
    showPersona,
    onOpenAgent,
  } = props;
  const { containerRef, sandboxRef } = useSandbox(true, meshUrl, annotations);

  const agent = mode.kind === 'change' ? null : (agents[mode.agentId] ?? null);
  const persona = agent ? personas.get(personaByAgent.get(agent.agentId) ?? '') : undefined;
  const taskId = mode.kind === 'replay' ? mode.taskId : (agent?.currentTaskId ?? null);
  const task = tasks.find((t) => t.id === taskId);
  const actions = (agent && taskId ? agent.history[taskId] : undefined) ?? NO_ACTIONS;
  const suggestion =
    mode.kind === 'change' ? (suggestions.find((s) => s.id === mode.suggestionId) ?? null) : null;

  useLive(actions, sandboxRef, mode.kind === 'live');
  const replay = useReplay(actions, sandboxRef, mode.kind === 'replay');
  const change = useChange(suggestion, sandboxRef, annotations);

  const chipsRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const chip = chipsRef.current?.children[Math.min(replay.cursor, actions.length - 1)];
    chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [replay.cursor, actions.length]);

  if (mode.kind === 'change') {
    return (
      <>
        <div className="col-head">
          <span className="eyebrow">Sandbox</span>
          <span className="meta">Proposed change</span>
        </div>
        <div className="col-body">
          <div className="sb">
            <div ref={containerRef} className="viewport">
              {suggestion && (
                <span className="vp-cap">
                  <span className="tag">{change.after ? 'After' : 'Before'}</span>
                  {suggestion.title}
                </span>
              )}
            </div>
            {suggestion && (
              <div className="ba">
                <div className="seg" role="group" aria-label="Compare">
                  <button
                    type="button"
                    className={change.after ? '' : 'on'}
                    onClick={() => {
                      change.setAfter(false);
                    }}
                  >
                    Before
                  </button>
                  <button
                    type="button"
                    className={change.after ? 'on' : ''}
                    onClick={() => {
                      change.setAfter(true);
                    }}
                  >
                    After
                  </button>
                </div>
                <span className="ba-cap">{suggestion.proposed_change.type.replace(/_/g, ' ')}</span>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  const shownStep = mode.kind === 'replay' ? replay.cursor : actions.length;
  const current = actions[shownStep - 1];
  const outcome = agent && taskId ? agent.outcomes[taskId] : undefined;
  const failure =
    agent && taskId && (outcome === 'failed' || outcome === 'errored')
      ? (agent.reasons[taskId] ?? 'No reason reported.')
      : null;
  const name = persona?.name ?? agent?.agentId.slice(0, 8) ?? 'agent';
  const kindLabel = mode.kind === 'live' ? 'Live' : 'Replay';

  return (
    <>
      <div className="col-head">
        <span className="eyebrow">Sandbox</span>
        <span className="meta">
          {kindLabel}
          {task && ` · ${task.name}`}
        </span>
      </div>
      <div className="col-body">
        <div className="sb">
          {showPersona && agent && (
            <div className="who-strip">
              <div className="line">
                <span className="av">{name.slice(0, 1)}</span>
                <span className="name">{name}</span>
                {persona && (
                  <span className="muted">
                    {persona.attributes.age} · {persona.attributes.gender}
                  </span>
                )}
                <span className={`pill ${agent.status}`}>{agent.status}</span>
              </div>
              <div className="line">
                <div className="chips">
                  {persona && persona.attributes.modifiers.length > 0 ? (
                    persona.attributes.modifiers.map((m) => (
                      <span key={m.id} className="chip">
                        {m.id.replace('_', ' ')}
                      </span>
                    ))
                  ) : (
                    <span className="muted">No modifiers</span>
                  )}
                </div>
                <div className="tdots" role="group" aria-label="This persona's tasks">
                  {tasks.map((t) => {
                    const o = agent.outcomes[t.id];
                    const live = agent.currentTaskId === t.id && !o;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={t.id === taskId ? 'on' : ''}
                        title={t.name}
                        aria-label={t.name}
                        disabled={!(t.id in agent.history)}
                        onClick={() => {
                          onOpenAgent(agent.agentId, t.id);
                        }}
                      >
                        <StatusIcon status={o ?? (live ? 'active' : 'pending')} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div ref={containerRef} className="viewport">
            <span className="vp-cap">
              <span className="tag">{kindLabel}</span>
              {task?.name}
            </span>
          </div>

          <div className="sb-body">
            {outcome && (
              <Recap
                outcome={outcome}
                actions={actions}
                summary={taskId ? agent?.summaries[taskId] : undefined}
                reason={failure}
              />
            )}
            <div className={`step ${mode.kind === 'live' && agent?.frameEndpoint ? 'live' : ''}`}>
              <div>
                <span className="eyebrow">
                  {mode.kind === 'replay'
                    ? `Step ${shownStep} of ${actions.length}`
                    : `Step ${shownStep}`}
                </span>
                {task && <span className="muted"> · {task.name}</span>}
                <div key={shownStep} className="action">
                  {current ? describeAction(current.chosen) : 'Waiting to start'}
                </div>
                {current?.reasoning && <q className="reason">{current.reasoning}</q>}
              </div>
              {mode.kind === 'live' && <LiveFrame endpoint={agent?.frameEndpoint ?? null} />}
            </div>
          </div>

          {mode.kind === 'replay' && (
            <div className="transport">
              <button
                type="button"
                className="ibtn"
                onClick={replay.toggle}
                aria-label={replay.playing && !replay.ended ? 'Pause' : 'Play'}
              >
                {replay.playing && !replay.ended ? <Pause /> : <Play />}
              </button>
              <input
                type="range"
                min={0}
                max={actions.length}
                value={replay.cursor}
                aria-label="Scrub"
                onChange={(e) => {
                  replay.scrub(Number(e.target.value));
                }}
              />
              <span className="pos">
                {replay.cursor}/{actions.length}
              </span>
              <ol ref={chipsRef} className="chips-steps">
                {actions.map((a, i) => (
                  <li key={a.step}>
                    <button
                      type="button"
                      className={i < replay.cursor ? 'done' : i === replay.cursor ? 'next' : ''}
                      onClick={() => {
                        replay.scrub(i + 1);
                      }}
                    >
                      <sup>{i + 1}</sup>
                      {describeAction(a.chosen)}
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
