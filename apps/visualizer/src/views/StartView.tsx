import type { StartResponse } from '@infallible/contracts';

interface Props {
  start: StartResponse | null;
  onStart: () => void;
  onSkip: () => void;
  busy: boolean;
}

export function StartView({ start, onStart, onSkip, busy }: Props) {
  if (!start) {
    return (
      <section className="hero">
        <h1 className="display">Infallible</h1>
        <button type="button" className="primary" onClick={onStart} disabled={busy}>
          Start
        </button>
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
