import type { TaskOutcome } from '@infallible/contracts';

import type { TaskStatus } from '../state/runStore';

const svg = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };
const stroke = { stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' } as const;

export const Check = () => (
  <svg {...svg} className="icon icon-check">
    <path d="M3.5 8.5l3 3 6-7" {...stroke} strokeLinejoin="round" />
  </svg>
);
export const Cross = () => (
  <svg {...svg} className="icon icon-cross">
    <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" {...stroke} />
  </svg>
);
export const Dash = () => (
  <svg {...svg} className="icon icon-dash">
    <path d="M4.5 8h7" {...stroke} />
  </svg>
);
export const Spinner = () => <span className="icon spinner" />;
export const Play = () => (
  <svg {...svg} className="icon">
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
  </svg>
);
export const Pause = () => (
  <svg {...svg} className="icon">
    <path d="M5 3.5v9M11 3.5v9" {...stroke} strokeWidth={2.2} />
  </svg>
);
export const ArrowLeft = () => (
  <svg {...svg} className="icon">
    <path d="M13 8H3.5M7 3.5L2.5 8 7 12.5" {...stroke} strokeLinejoin="round" />
  </svg>
);
export const ArrowRight = () => (
  <svg {...svg} className="icon">
    <path d="M3 8h9.5M9 3.5L13.5 8 9 12.5" {...stroke} strokeLinejoin="round" />
  </svg>
);
export const Close = () => (
  <svg {...svg} className="icon">
    <path d="M4 4l8 8M12 4l-8 8" {...stroke} />
  </svg>
);

/** Task progress (run-wide) or an agent's outcome, as one glyph. */
export function StatusIcon({ status }: { status: TaskStatus | TaskOutcome }) {
  switch (status) {
    case 'done':
    case 'passed':
      return (
        <span className="status status-ok">
          <Check />
        </span>
      );
    case 'failed':
    case 'errored':
      return (
        <span className="status status-bad">
          <Cross />
        </span>
      );
    case 'active':
      return (
        <span className="status status-active">
          <Spinner />
        </span>
      );
    case 'pending':
      return (
        <span className="status status-pending">
          <Dash />
        </span>
      );
  }
}
