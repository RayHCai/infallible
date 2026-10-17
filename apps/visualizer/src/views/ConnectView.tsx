import type { Device } from '@infallible/contracts';
import { useEffect, useState } from 'react';

import { driver } from '../sim/mockDriver';
import { useSandbox } from '../three/useSandbox';

const POLL_MS = 2000;

interface Props {
  meshUrl: string | null;
  busy: boolean;
  onConnect: (deviceId: string | null) => void;
}

export function ConnectView({ meshUrl, busy, onConnect }: Props) {
  const { containerRef } = useSandbox(false, meshUrl, null);
  const [devices, setDevices] = useState<Device[]>([]);

  useEffect(() => {
    let alive = true;
    const poll = () => {
      driver
        .devices()
        .then((d) => {
          if (alive) setDevices(d);
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="split">
      <div ref={containerRef} className="preview" />
      <aside className="side">
        <h2>Connect device</h2>
        <p className="muted searching">
          <span className="spinner" /> Searching for devices
        </p>
        {devices.length > 0 && (
          <ul className="devices">
            {devices.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    onConnect(d.id);
                  }}
                  disabled={busy}
                >
                  <span>{d.name}</span>
                  <span className="muted">{d.port}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="link"
          onClick={() => {
            onConnect(null);
          }}
          disabled={busy}
        >
          Use default firmware
        </button>
      </aside>
    </section>
  );
}
