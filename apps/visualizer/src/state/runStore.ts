import type { Action, BuildSource, DriverMessage, Run, TaskOutcome } from '@infallible/contracts';

type AgentStatus = 'starting' | 'ready' | 'working' | 'idle' | 'error';

export interface ActionRecord {
  step: number;
  chosen: Action;
  reasoning: string;
  at: string;
}

export interface AgentView {
  agentId: string;
  frameEndpoint: string | null;
  status: AgentStatus;
  currentTaskId: string | null;
  step: number;
  passed: number;
  failed: number;
  errored: number;
  lastReasoning: string | null;
  lastError: string | null;
  /** Every action per task, in order; this is what the sandbox replays. */
  history: Record<string, ActionRecord[]>;
  outcomes: Record<string, TaskOutcome>;
  /** Driver's explanation for failed/errored tasks. */
  reasons: Record<string, string>;
  /** Claude's recap of each finished task; arrives shortly after scoring. */
  summaries: Record<string, string>;
}

export interface RunView {
  run: Run | null;
  build: { stage: string; progress: number; source: BuildSource | null; meshUrl: string | null };
  agents: Record<string, AgentView>;
  suggestionsCount: number | null;
}

export const initialRunView: RunView = {
  run: null,
  build: { stage: 'waiting for scan', progress: 0, source: null, meshUrl: null },
  agents: {},
  suggestionsCount: null,
};

const newAgent = (agentId: string): AgentView => ({
  agentId,
  frameEndpoint: null,
  status: 'starting',
  currentTaskId: null,
  step: 0,
  passed: 0,
  failed: 0,
  errored: 0,
  lastReasoning: null,
  lastError: null,
  history: {},
  outcomes: {},
  reasons: {},
  summaries: {},
});

function patchAgent(state: RunView, agentId: string, patch: (a: AgentView) => Partial<AgentView>) {
  const current = state.agents[agentId] ?? newAgent(agentId);
  return { ...state, agents: { ...state.agents, [agentId]: { ...current, ...patch(current) } } };
}

/** Pure reducer: driver WS message -> dashboard state. */
export function runReducer(state: RunView, message: DriverMessage): RunView {
  switch (message.type) {
    case 'run_state': {
      const isNewRun = state.run?.id !== message.run.id;
      return isNewRun ? { ...initialRunView, run: message.run } : { ...state, run: message.run };
    }
    case 'build_progress':
      return {
        ...state,
        build: { ...state.build, stage: message.stage, progress: message.progress },
      };
    case 'build_done':
      return {
        ...state,
        build: { ...state.build, progress: 1, source: message.source, meshUrl: message.mesh_url },
      };
    case 'task_scored':
      return patchAgent(state, message.agent_id, (a) => ({
        status: 'idle',
        passed: a.passed + (message.outcome === 'passed' ? 1 : 0),
        failed: a.failed + (message.outcome === 'failed' ? 1 : 0),
        errored: a.errored + (message.outcome === 'errored' ? 1 : 0),
        outcomes: { ...a.outcomes, [message.task_id]: message.outcome },
        reasons: message.reason ? { ...a.reasons, [message.task_id]: message.reason } : a.reasons,
      }));
    case 'task_summary':
      return patchAgent(state, message.agent_id, (a) => ({
        summaries: { ...a.summaries, [message.task_id]: message.summary },
      }));
    case 'suggestions_ready':
      return { ...state, suggestionsCount: message.count };
    case 'agent_event': {
      const e = message.event;
      switch (e.type) {
        case 'agent_ready':
          return patchAgent(state, e.agent_id, () => ({
            status: 'ready',
            frameEndpoint: e.frame_endpoint,
          }));
        case 'task_started':
          return patchAgent(state, e.agent_id, (a) => ({
            status: 'working',
            currentTaskId: e.task_id,
            step: 0,
            lastReasoning: null,
            history: { ...a.history, [e.task_id]: [] },
          }));
        case 'action':
          return patchAgent(state, e.agent_id, (a) => ({
            step: e.step + 1,
            lastReasoning: e.reasoning || null,
            history: {
              ...a.history,
              [e.task_id]: [
                ...(a.history[e.task_id] ?? []),
                { step: e.step, chosen: e.chosen, reasoning: e.reasoning, at: e.at },
              ],
            },
          }));
        case 'task_done':
          return patchAgent(state, e.agent_id, () => ({ step: e.steps }));
        case 'agent_error':
          return patchAgent(state, e.agent_id, () => ({ status: 'error', lastError: e.message }));
      }
    }
  }
}

export type TaskStatus = 'done' | 'active' | 'pending';

/** Run-wide status of one task across every agent. */
export function taskStatus(taskId: string, agents: AgentView[]): TaskStatus {
  if (agents.length === 0) return 'pending';
  const scored = agents.filter((a) => taskId in a.outcomes).length;
  if (scored === agents.length) return 'done';
  if (scored > 0 || agents.some((a) => a.currentTaskId === taskId)) return 'active';
  return 'pending';
}
