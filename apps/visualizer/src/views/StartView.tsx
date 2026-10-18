import type { RunListing, StartResponse } from '@infallible/contracts';

interface Props {
  start: StartResponse | null;
  onStart: () => void;
  onSkip: () => void;
  busy: boolean;
  runs?: RunListing[];
  onOpenRun?: (runId: string) => void;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function StartView({ start, onStart, onSkip, busy, runs = [], onOpenRun }: Props) {
  if (!start) {
    return (
      <section className="hero">
        <h1 className="display">Infallible</h1>
        <button type="button" className="primary" onClick={onStart} disabled={busy}>
          Start
        </button>
        {runs.length > 0 && (
          <div className="past">
            <p className="eyebrow">Previous runs</p>
            <ul>
              {runs.map(({ run, created_at, passed, total }) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenRun?.(run.id);
                    }}
                    disabled={busy}
                  >
                    <span>{when.format(new Date(created_at))}</span>
                    <span className="muted">
                      {run.state} · {passed}/{total} passed
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    );
  }
  return (
    <section className="hero">
      <p className="eyebrow">Scan to capture the pump</p>
      <div className="qr">
        {start.qr_png_b64 ? (
          <img
            alt="QR code for the scanner app"
            src={`data:image/png;base64,${start.qr_png_b64}`}
          />
        ) : (
          <span className="qr-empty">QR</span>
        )}
      </div>
      <button type="button" className="link" onClick={onSkip} disabled={busy}>
        Skip scan
      </button>
    </section>
  );
}
