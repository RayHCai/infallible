export const DRIVER_URL = (import.meta.env.VITE_DRIVER_URL ?? 'http://localhost:8000').replace(
  /\/+$/,
  '',
);

export const DRIVER_WS_URL = `${DRIVER_URL.replace(/^http/, 'ws')}/ws`;
