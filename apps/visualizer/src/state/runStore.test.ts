import type { DriverMessage } from '@infallible/contracts';
import { describe, expect, it } from 'vitest';

import { type AgentView, initialRunView, runReducer, taskStatus } from './runStore';

const RUN = '00000000-0000-4000-8000-000000000001';
const AGENT = '00000000-0000-4000-8000-000000000002';
const TASK = '00000000-0000-4000-8000-000000000003';
const at = '2026-01-01T00:00:00Z';

const reduce = (...messages: DriverMessage[]) => messages.reduce(runReducer, initialRunView);

describe('runReducer', () => {
  it('tracks an agent through a task', () => {
    const state = reduce(
      { type: 'run_state', run: { id: RUN, state: 'running', current_task_index: 0 } },
      {
        type: 'agent_event',
        event: { type: 'agent_ready', run_id: RUN, agent_id: AGENT, at, frame_endpoint: 'h:1' },
      },
      {
        type: 'agent_event',
        event: { type: 'task_started', run_id: RUN, agent_id: AGENT, at, task_id: TASK },
      },
      {
        type: 'agent_event',
        event: {
          type: 'action',
          run_id: RUN,
          agent_id: AGENT,
          at,
          task_id: TASK,
          step: 0,
          options: [],
          chosen: { kind: 'press', button_id: 'up' },
          reasoning: 'up',
          state_after: {},
          trace_path: '',
        },
      },
      {
        type: 'task_scored',
        run_id: RUN,
        agent_id: AGENT,
        task_id: TASK,
        outcome: 'failed',
        reason: 'nope',
      },
    );
    expect(state.agents[AGENT]).toMatchObject({
      frameEndpoint: 'h:1',
      currentTaskId: TASK,
      failed: 1,
      status: 'idle',
      outcomes: { [TASK]: 'failed' },
      reasons: { [TASK]: 'nope' },
    });
    expect(state.agents[AGENT]?.history[TASK]).toEqual([
      { step: 0, chosen: { kind: 'press', button_id: 'up' }, reasoning: 'up', at },
    ]);
  });

  it('resets when a new run starts', () => {
    const first = reduce(
      { type: 'run_state', run: { id: RUN, state: 'running', current_task_index: 0 } },
      { type: 'suggestions_ready', run_id: RUN, count: 3 },
    );
    const next = runReducer(first, {
      type: 'run_state',
      run: { id: AGENT, state: 'prep', current_task_index: 0 },
    });
    expect(next.suggestionsCount).toBeNull();
    expect(next.run?.id).toBe(AGENT);
  });
});

describe('taskStatus', () => {
  const base = runReducer(initialRunView, {
    type: 'agent_event',
    event: { type: 'agent_ready', run_id: RUN, agent_id: AGENT, at, frame_endpoint: '' },
  }).agents[AGENT];
  if (!base) throw new Error('agent missing');
  const agent = (patch: Partial<AgentView>): AgentView => ({ ...base, ...patch });

  it('is pending until an agent picks the task up', () => {
    expect(taskStatus(TASK, [])).toBe('pending');
    expect(taskStatus(TASK, [agent({})])).toBe('pending');
  });

  it('is active while any agent works on it or some have scored', () => {
    expect(taskStatus(TASK, [agent({ currentTaskId: TASK })])).toBe('active');
    expect(taskStatus(TASK, [agent({ outcomes: { [TASK]: 'passed' } }), agent({})])).toBe('active');
  });

  it('is done once every agent has an outcome', () => {
    expect(taskStatus(TASK, [agent({ outcomes: { [TASK]: 'passed' } })])).toBe('done');
  });
});
