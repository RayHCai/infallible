import type { DriverMessage } from '@infallible/contracts';

import { DRIVER_WS_URL } from '../config';

type Listener = (message: DriverMessage) => void;

/**
 * Run-level event stream from the driver. Reconnects with backoff; on every
 * (re)connect the driver sends a `run_state` snapshot first.
 */
export function connectDriverSocket(onMessage: Listener, url = DRIVER_WS_URL): () => void {
  let socket: WebSocket | null = null;
  let retry = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const open = () => {
    socket = new WebSocket(url);
    socket.onopen = () => {
      retry = 0;
    };
    socket.onmessage = (ev: MessageEvent<string>) => {
      onMessage(JSON.parse(ev.data) as DriverMessage);
    };
    socket.onclose = () => {
      if (closed) return;
      const delay = Math.min(10_000, 250 * 2 ** retry++);
      timer = setTimeout(open, delay);
    };
  };

  open();
  return () => {
    closed = true;
    clearTimeout(timer);
    socket?.close();
  };
}
