import type { TaskOutcome } from '@infallible/contracts';

import type { TaskStatus } from '../state/runStore';

const svg = { viewBox: '0 0 16 16', 'aria-hidden': true } as const;

const Icon = ({ d, className = '' }: { d: string; className?: string }) => (
  <svg {...svg} className={`g ${className}`}>
    <path d={d} />
  </svg>
);

export const ChevronRight = () => <Icon d="M6 4l4 4-4 4" />;
export const Play = () => (
  <svg {...svg} className="g">
    <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
  </svg>
);
export const Pause = () => <Icon d="M5.5 3.5v9M10.5 3.5v9" />;
export const Bars = () => (
  <svg {...svg} className="g">
    <rect x="2" y="2" width="3" height="12" rx="1" />
    <rect x="6.5" y="2" width="3" height="12" rx="1" />
    <rect x="11" y="2" width="3" height="12" rx="1" />
  </svg>
);
export const TasksIcon = () => (
  <svg {...svg} className="g">
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5 6h6M5 8.5h6M5 11h3.5" />
  </svg>
);
export const PersonasIcon = () => (
  <svg {...svg} className="g">
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
  </svg>
);
export const SuggestionsIcon = () => (
  <Icon d="M6 12.5h4M6.5 14.5h3M8 1.8a4.2 4.2 0 0 0-2.5 7.6c.4.3.5.7.5 1.1v.5h4v-.5c0-.4.1-.8.5-1.1A4.2 4.2 0 0 0 8 1.8z" />
);
export const Spinner = () => <span className="spin" />;

/** Task progress (run-wide) or an agent's outcome, as one glyph. */
export function StatusIcon({ status }: { status: TaskStatus | TaskOutcome }) {
  switch (status) {
    case 'done':
      return (
        <svg {...svg} className="g g-done">
          <circle cx="8" cy="8" r="6" />
          <path d="M5.3 8.2l1.8 1.8 3.6-3.8" />
        </svg>
      );
    case 'passed':
      return (
        <svg {...svg} className="g g-passed">
          <circle cx="8" cy="8" r="6" />
          <path d="M5.3 8.2l1.8 1.8 3.6-3.8" />
        </svg>
      );
    case 'failed':
      return (
        <svg {...svg} className="g g-failed">
          <circle cx="8" cy="8" r="6" />
          <path d="M6 6l4 4M10 6l-4 4" />
        </svg>
      );
    case 'errored':
      return (
        <svg {...svg} className="g g-errored">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3.5M8 10.8v.2" />
        </svg>
      );
    case 'active':
      return <Spinner />;
    case 'pending':
      return (
        <svg {...svg} className="g g-pending">
          <circle cx="8" cy="8" r="6" strokeDasharray="2 2.4" />
        </svg>
      );
  }
}
