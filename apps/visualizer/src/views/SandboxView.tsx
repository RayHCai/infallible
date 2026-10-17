import type { MeshAnnotations, Persona, Suggestion, Task } from '@infallible/contracts';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import type { ActionRecord, AgentView } from '../state/runStore';
import { describeAction, poseAfter } from '../three/eyePose';
import type { Sandbox } from '../three/sandbox';
import { useSandbox } from '../three/useSandbox';
import { ArrowLeft, Pause, Play, StatusIcon } from '../ui/icons';
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
  onClose: () => void;
  onOpen: (mode: SandboxMode) => void;
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
    onClose,
    onOpen,
  } = props;
  const { containerRef, sandboxRef } = useSandbox(true, meshUrl, annotations);

  const agent = mode.kind === 'change' ? null : (agents[mode.agentId] ?? null);
  const persona = agent ? personas.get(personaByAgent.get(agent.agentId) ?? '') : undefined;
  const taskId = mode.kind === 'replay' ? mode.taskId : (agent?.currentTaskId ?? null);
  const actions = (agent && taskId ? agent.history[taskId] : undefined) ?? NO_ACTIONS;
  const suggestion =
    mode.kind === 'change' ? (suggestions.find((s) => s.id === mode.suggestionId) ?? null) : null;

  useLive(actions, sandboxRef, mode.kind === 'live');
  const replay = useReplay(actions, sandboxRef, mode.kind === 'replay');
  const change = useChange(suggestion, sandboxRef, annotations);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const shownStep = mode.kind === 'replay' ? replay.cursor : actions.length;
  const current = actions[shownStep - 1];

  return (
    <div className="sandbox">
      <div ref={containerRef} className="sandbox-canvas" />
      <div className="hud">
        <div className="hud-left">
          <button type="button" className="ghost small" onClick={onClose}>
            <ArrowLeft />
            Back
          </button>

          {mode.kind === 'change' ? (
            suggestion && (
              <article key={suggestion.id} className="card hud-card">
                <span className={`tag tag-${suggestion.category}`}>{suggestion.category}</span>
                <h3>{suggestion.title}</h3>
                <p className="muted">{suggestion.rationale}</p>
                <div className="segmented">
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
                {suggestion.evidence.length > 0 && (
                  <>
                    <span className="eyebrow">Evidence</span>
                    <ul className="rows rows-compact">
                      {suggestion.evidence.map((e) => (
                        <li key={`${e.agent_id}:${e.task_id}:${e.step}`}>
                          <button
                            type="button"
                            className="row"
                            onClick={() => {
                              onOpen({ kind: 'replay', agentId: e.agent_id, taskId: e.task_id });
                            }}
                          >
                            <span className="row-title">
                              {personas.get(personaByAgent.get(e.agent_id) ?? '')?.name ?? 'agent'}
                            </span>
                            <span className="row-meta">
                              {tasks.find((t) => t.id === e.task_id)?.name ?? 'task'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
            )
          ) : (
            <>
              <article className="card hud-card">
                <header className="card-head">
                  <span className="avatar">{(persona?.name ?? 'A').slice(0, 1)}</span>
                  <span className="row-body">
                    <h3>{persona?.name ?? agent?.agentId.slice(0, 8)}</h3>
                    {persona && (
                      <span className="muted">
                        {persona.attributes.age}, {persona.attributes.gender}
                      </span>
                    )}
                  </span>
                  {agent && <span className={`pill pill-${agent.status}`}>{agent.status}</span>}
                </header>
                {persona && <p className="muted">{persona.description}</p>}
                {persona && persona.attributes.modifiers.length > 0 && (
                  <div className="chips">
                    {persona.attributes.modifiers.map((m) => (
                      <span key={m.id} className="chip">
                        {m.id.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                )}
              </article>

              <article className="card hud-card">
                <header className="card-head">
                  <span className="eyebrow">
                    {mode.kind === 'replay'
                      ? `Step ${shownStep} of ${actions.length}`
                      : `Step ${shownStep}`}
                  </span>
                  <span className="muted">{tasks.find((t) => t.id === taskId)?.name}</span>
                </header>
                <div key={shownStep} className="action-now">
                  {current ? describeAction(current.chosen) : 'waiting'}
                </div>
                {current?.reasoning && <q className="reasoning">{current.reasoning}</q>}
                {mode.kind === 'live' && <LiveFrame endpoint={agent?.frameEndpoint ?? null} />}
              </article>
            </>
          )}
        </div>

        <div className="hud-right">
          {mode.kind === 'change' ? (
            <article className="card hud-card">
              <header className="card-head">
                <h3>Suggestions</h3>
                <span className="count">{suggestions.length}</span>
              </header>
              <ul className="rows rows-compact">
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className={`row ${s.id === suggestion?.id ? 'row-selected' : ''}`}
                      onClick={() => {
                        onOpen({ kind: 'change', suggestionId: s.id });
                      }}
                    >
                      <span className={`tag tag-${s.category}`}>{s.category}</span>
                      <span className="row-title">{s.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          ) : (
            agent && (
              <article className="card hud-card">
                <header className="card-head">
                  <h3>Tasks</h3>
                  <span className="count">
                    {Object.keys(agent.outcomes).length}/{tasks.length}
                  </span>
                </header>
                <ul className="rows rows-compact">
                  {tasks.map((t) => {
                    const outcome = agent.outcomes[t.id];
                    const live = agent.currentTaskId === t.id && !outcome;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          className={`row ${t.id === taskId ? 'row-selected' : ''}`}
                          disabled={!(t.id in agent.history)}
                          onClick={() => {
                            onOpen(
                              live
                                ? { kind: 'live', agentId: agent.agentId }
                                : { kind: 'replay', agentId: agent.agentId, taskId: t.id },
                            );
                          }}
                        >
                          <StatusIcon status={outcome ?? (live ? 'active' : 'pending')} />
                          <span className="row-title">{t.name}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </article>
            )
          )}
        </div>

        {mode.kind === 'replay' && (
          <div className="transport card">
            <button
              type="button"
              className="icon-btn"
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
              onChange={(e) => {
                replay.scrub(Number(e.target.value));
              }}
            />
            <ol className="steps">
              {actions.map((a, i) => (
                <li key={a.step}>
                  <button
                    type="button"
                    className={i < replay.cursor ? 'done' : i === replay.cursor ? 'next' : ''}
                    onClick={() => {
                      replay.scrub(i + 1);
                    }}
                  >
                    {describeAction(a.chosen)}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
