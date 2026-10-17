import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initialRunView, runReducer, type RunView } from '../state/runStore';
import { PERSONAS, TASKS } from './dummyData';
import { createMockDriver } from './mockDriver';

describe('mockDriver', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('walks a run from prep to completed', async () => {
    const driver = createMockDriver(10);
    let view: RunView = initialRunView;
    driver.subscribe((m) => {
      view = runReducer(view, m);
    });

    const { run_id } = await driver.start();
    expect(view.run?.state).toBe('prep');
    await expect(driver.connect()).rejects.toThrow();

    await driver.skipScan(run_id);
    await vi.runAllTimersAsync();
    expect(view.run?.state).toBe('connect');
    expect(view.build.source).toBe('fallback');

    await driver.connect();
    expect(view.run?.state).toBe('running');
    await vi.runAllTimersAsync();

    expect(view.run?.state).toBe('completed');
    expect(view.suggestionsCount).toBeGreaterThan(0);
    const agents = Object.values(view.agents);
    expect(agents).toHaveLength(PERSONAS.length);
    const scored = agents.reduce((n, a) => n + a.passed + a.failed + a.errored, 0);
    expect(scored).toBe(PERSONAS.length * TASKS.length);
  });

  it('stops mid-run', async () => {
    const driver = createMockDriver(10);
    let view: RunView = initialRunView;
    driver.subscribe((m) => {
      view = runReducer(view, m);
    });

    const { run_id } = await driver.start();
    await driver.skipScan(run_id);
    await vi.runAllTimersAsync();
    await driver.connect();
    await driver.stop(run_id);
    await vi.runAllTimersAsync();

    expect(view.run?.state).toBe('stopped');
  });
});
