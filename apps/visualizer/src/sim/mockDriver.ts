import type {
  Action,
  Agent,
  ConnectResponse,
  Device,
  DriverMessage,
  MeshAnnotations,
  Persona,
  Run,
  RunState,
  StartResponse,
  SuggestionsFile,
  Task,
} from '@infallible/contracts';
import QRCode from 'qrcode';

import {
  ACTION_MIX,
  ANNOTATIONS,
  FAILS,
  PERSONAS,
  REASONING,
  SUGGESTION_EVIDENCE,
  SUGGESTIONS,
  TASKS,
} from './dummyData';

type Listener = (message: DriverMessage) => void;

const BUILD_STAGES = ['segmenting frames', 'reconstructing mesh', 'annotating screen and buttons'];
const TERMINAL: RunState[] = ['completed', 'stopped', 'failed'];

/** Rejects (like a failed request) instead of throwing synchronously. */
const resolve = <T>(fn: () => T) =>
  new Promise<T>((done) => {
    done(fn());
  });

/**
 * In-browser stand-in for the driver: the same calls and WS messages as
 * `api/driver` + `api/driverSocket`, driven by timers over dummy data.
 */
export function createMockDriver(stepMs = 900) {
  const listeners = new Set<Listener>();
  let timers: ReturnType<typeof setTimeout>[] = [];
  let run: Run | null = null;
  let agents: Agent[] = [];

  const emit = (message: DriverMessage) => {
    for (const listener of listeners) listener(message);
  };
  const later = (ms: number, fn: () => void) => {
    timers.push(setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const setState = (state: RunState) => {
    if (!run) return;
    run = { ...run, state };
    emit({ type: 'run_state', run });
  };
  const expectState = (runId: string | null, state: RunState) => {
    if (!run || (runId !== null && run.id !== runId) || run.state !== state) {
      throw new Error(`no run in '${state}'`);
    }
    return run;
  };

  /** Schedules one agent's whole run; returns when (ms) it finishes. */
  const simulateAgent = (agent: Agent, index: number): number => {
    const base = { run_id: agent.run_id, agent_id: agent.id };
    const at = () => new Date().toISOString();
    const pace = stepMs * (1 + 0.2 * index);
    const fails = FAILS[agent.persona_id] ?? [];
    let t = 300 * index;

    later(t, () => {
      emit({
        type: 'agent_event',
        event: { ...base, at: at(), type: 'agent_ready', frame_endpoint: agent.frame_endpoint },
      });
    });
    TASKS.forEach((task, taskIndex) => {
      const steps = 5 + ((index + 2 * taskIndex) % 4);
      later((t += pace), () => {
        emit({
          type: 'agent_event',
          event: { ...base, at: at(), type: 'task_started', task_id: task.id },
        });
      });
      for (let step = 0; step < steps; step++) {
        const mixed = ACTION_MIX[(index * 3 + taskIndex + step) % ACTION_MIX.length];
        const chosen: Action = step === steps - 1 || !mixed ? { kind: 'done' } : mixed;
        later((t += pace), () => {
          emit({
            type: 'agent_event',
            event: {
              ...base,
              at: at(),
              type: 'action',
              task_id: task.id,
              step,
              options: ANNOTATIONS.buttons.map((b) => `press(${b.id})`),
              chosen,
              reasoning: REASONING[(index + step) % REASONING.length] ?? '',
              state_after: {},
              trace_path: `runs/${agent.run_id}/traces/${agent.id}/${task.id}.json`,
            },
          });
        });
      }
      later((t += pace / 2), () => {
        emit({
          type: 'agent_event',
          event: {
            ...base,
            at: at(),
            type: 'task_done',
            task_id: task.id,
            steps,
            declared_done: true,
            final_state: {},
          },
        });
        emit({
          type: 'task_scored',
          ...base,
          task_id: task.id,
          outcome: fails.includes(task.id) ? 'failed' : 'passed',
        });
      });
    });
    return t;
  };

  return {
    /** Replaces the driver WS: snapshot on subscribe, then every message. */
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      if (run) listener({ type: 'run_state', run });
      return () => {
        listeners.delete(listener);
      };
    },

    start: async () => {
      const res = await resolve<StartResponse>(() => {
        if (run && !TERMINAL.includes(run.state)) throw new Error('a run is already active');
        clearTimers();
        agents = [];
        run = { id: crypto.randomUUID(), state: 'prep', current_task_index: 0 };
        emit({ type: 'run_state', run });
        return {
          run_id: run.id,
          state: run.state,
          qr: { run_id: run.id, driver_url: 'http://localhost:8000' },
          qr_png_b64: '',
        };
      });
      // Real QR so the scanner can be tested; nothing listens for its upload yet.
      const url = await QRCode.toDataURL(JSON.stringify(res.qr), { margin: 0, width: 512 });
      return { ...res, qr_png_b64: url.slice(url.indexOf(',') + 1) };
    },

    /** Stands in for the scanner's `POST /build`; always lands on the fallback mesh. */
    skipScan: (runId: string) =>
      resolve(() => {
        const { id } = expectState(runId, 'prep');
        setState('build');
        BUILD_STAGES.forEach((stage, i) => {
          later(stepMs * (i + 1), () => {
            emit({ type: 'build_progress', run_id: id, stage, progress: i / BUILD_STAGES.length });
          });
        });
        later(stepMs * (BUILD_STAGES.length + 1), () => {
          emit({ type: 'build_done', run_id: id, source: 'fallback', mesh_url: '' });
          setState('connect');
        });
      }),

    connect: (_deviceId: string | null = null) =>
      resolve<ConnectResponse>(() => {
        const { id } = expectState(null, 'connect');
        // Empty frame_endpoint: there is no agent-persona to stream frames from.
        agents = PERSONAS.map((p) => ({
          id: crypto.randomUUID(),
          run_id: id,
          persona_id: p.id,
          firmware_endpoint: 'local',
          frame_endpoint: '',
        }));
        setState('running');
        const end = Math.max(...agents.map(simulateAgent));
        later(end + stepMs, () => {
          setState('evaluating');
        });
        later(end + stepMs * 4, () => {
          emit({ type: 'suggestions_ready', run_id: id, count: SUGGESTIONS.length });
          setState('completed');
        });
        return { run_id: id, firmware_endpoints: agents.map((a) => a.firmware_endpoint) };
      }),

    stop: (runId: string) =>
      resolve<Run>(() => {
        if (run?.id !== runId) throw new Error('unknown run');
        clearTimers();
        setState('stopped');
        return run;
      }),

    agents: (_runId: string) => resolve<Agent[]>(() => agents),
    annotations: (_runId: string) => resolve<MeshAnnotations>(() => ANNOTATIONS),
    suggestions: (_runId: string) =>
      resolve<SuggestionsFile>(() => ({
        suggestions: SUGGESTIONS.map((s) => ({
          ...s,
          evidence: (SUGGESTION_EVIDENCE[s.id] ?? []).flatMap(([personaId, taskId]) => {
            const agent = agents.find((a) => a.persona_id === personaId);
            return agent ? [{ agent_id: agent.id, task_id: taskId, step: 2 }] : [];
          }),
        })),
      })),
    devices: () => resolve<Device[]>(() => []),
    personas: () => resolve<Persona[]>(() => PERSONAS),
    tasks: () => resolve<Task[]>(() => TASKS),
  };
}

export const driver = createMockDriver();
