import { describe, expect, it } from 'vitest';

import { INITIAL_POSE, poseAfter } from './eyePose';

describe('poseAfter', () => {
  it('folds view actions and ignores the rest', () => {
    const pose = poseAfter([
      { kind: 'press', button_id: 'up' },
      { kind: 'rotate_view', axis: 'y', deg: 90 },
      { kind: 'zoom', delta: 0.5 },
      { kind: 'done' },
    ]);
    expect(pose.yaw).toBeCloseTo(Math.PI / 2);
    expect(pose.radius).toBeCloseTo(INITIAL_POSE.radius / 2);
    expect(pose.pitch).toBe(INITIAL_POSE.pitch);
  });

  it('stops after `count` actions and clamps zoom', () => {
    const actions = [
      { kind: 'zoom', delta: 0.9 },
      { kind: 'zoom', delta: 0.9 },
      { kind: 'rotate_view', axis: 'y', deg: 10 },
    ] as const;
    expect(poseAfter(actions, 2)).toEqual({ ...INITIAL_POSE, radius: 0.6 });
    expect(poseAfter(actions, 0)).toBe(INITIAL_POSE);
  });
});
