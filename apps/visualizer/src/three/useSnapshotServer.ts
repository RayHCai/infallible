import type { MeshAnnotations, RenderRequest } from '@infallible/contracts';
import { useEffect, useRef } from 'react';

import { Snapshotter } from './snapshotter';

const MAX_RETRY_MS = 5000;

/**
 * Serve 3D snapshots to every agent of the run: agents render nothing
 * themselves, they ask the open visualizer (`ws://{frame_endpoint}/render`).
 */
export function useSnapshotServer(
  meshUrl: string | null,
  annotations: MeshAnnotations | null,
  endpoints: readonly string[],
) {
  const snapshotter = useRef<Snapshotter | null>(null);

  useEffect(() => {
    if (!annotations) return;
    const s = new Snapshotter(annotations);
    s.loadMesh(meshUrl);
    snapshotter.current = s;
    return () => {
      s.dispose();
      snapshotter.current = null;
    };
  }, [meshUrl, annotations]);

  const key = [...endpoints].sort().join(' ');
  useEffect(() => {
    if (!annotations || !key) return;
    const stops = key.split(' ').map((endpoint) => serve(endpoint, () => snapshotter.current));
    return () => {
      for (const stop of stops) stop();
    };
  }, [key, annotations]);
}

/** One reconnecting render socket per agent. Returns a stop function. */
function serve(endpoint: string, snapshotter: () => Snapshotter | null): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let delay = 500;

  const open = () => {
    const ws = new WebSocket(`ws://${endpoint}/render`);
    socket = ws;
    ws.onopen = () => {
      delay = 500;
    };
    ws.onmessage = (ev: MessageEvent<unknown>) => {
      const s = snapshotter();
      if (typeof ev.data !== 'string' || !s) return;
      const request = JSON.parse(ev.data) as RenderRequest;
      s.render(request).then(
        (reply) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(reply));
        },
        (err: unknown) => {
          console.warn('snapshot failed', endpoint, err);
        },
      );
    };
    ws.onclose = () => {
      if (stopped) return;
      retry = setTimeout(open, delay);
      delay = Math.min(delay * 2, MAX_RETRY_MS);
    };
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket?.close();
  };
}
