export type * from './generated';

import type { DriverMessage, QrPayload } from './generated';

/** Narrow a driver WS message by its `type` discriminator. */
export type DriverMessageOf<T extends DriverMessage['type']> = Extract<DriverMessage, { type: T }>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validate what the scanner read from the visualizer's QR code. */
export function parseQrPayload(raw: string): QrPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { run_id, driver_url } = value as Record<string, unknown>;
  if (typeof run_id !== 'string' || !UUID_RE.test(run_id)) return null;
  if (typeof driver_url !== 'string' || !/^https?:\/\//.test(driver_url)) return null;
  return { run_id, driver_url: driver_url.replace(/\/+$/, '') };
}
