import type { Action } from '@infallible/contracts';

/** Where the agent's eye sits relative to the pump: spherical, radius in pump heights. */
export interface EyePose {
  yaw: number;
  pitch: number;
  radius: number;
}

export const INITIAL_POSE: EyePose = { yaw: 0, pitch: 0.12, radius: 1.7 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** View actions move the eye; everything else leaves it where it is. */
export function applyAction(pose: EyePose, action: Action): EyePose {
  switch (action.kind) {
    case 'rotate_view':
      if (action.axis === 'y') return { ...pose, yaw: pose.yaw + rad(action.deg) };
      if (action.axis === 'x')
        return { ...pose, pitch: clamp(pose.pitch + rad(action.deg), -1.2, 1.2) };
      return pose;
    case 'zoom':
      return { ...pose, radius: clamp(pose.radius * (1 - action.delta), 0.6, 4) };
    default:
      return pose;
  }
}

/** Pose after the first `count` actions. */
export function poseAfter(actions: readonly Action[], count = actions.length): EyePose {
  let pose = INITIAL_POSE;
  for (const action of actions.slice(0, count)) pose = applyAction(pose, action);
  return pose;
}

/** Short human label for an action, used in cards and the replay strip. */
export function describeAction(action: Action): string {
  switch (action.kind) {
    case 'press':
      return `press ${action.button_id}`;
    case 'hold':
      return `hold ${action.button_id} ${action.ms} ms`;
    case 'turn':
      return `turn ${action.dial} ${action.steps > 0 ? '+' : ''}${action.steps}`;
    case 'rotate_view':
      return `rotate ${action.deg > 0 ? '+' : ''}${action.deg}° ${action.axis}`;
    case 'zoom':
      return action.delta > 0 ? 'bring closer' : 'move away';
    case 'wait':
      return `wait ${action.ms} ms`;
    case 'read_screen':
      return 'read screen';
    case 'done':
      return 'done';
  }
}
