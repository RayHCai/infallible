import { describe, expect, it } from 'vitest';

import { parseQrPayload } from './index';

describe('parseQrPayload', () => {
  const runId = '4b0f6c2e-1d7a-4f3e-9a51-2f8c7d1e6a01';

  it('accepts a valid payload and trims trailing slashes', () => {
    const raw = JSON.stringify({ run_id: runId, driver_url: 'http://192.168.1.20:8000/' });
    expect(parseQrPayload(raw)).toEqual({ run_id: runId, driver_url: 'http://192.168.1.20:8000' });
  });

  it.each([
    'not json',
    'null',
    JSON.stringify({ run_id: 'nope', driver_url: 'http://x' }),
    JSON.stringify({ run_id: runId, driver_url: 'ftp://x' }),
  ])('rejects %s', (raw) => {
    expect(parseQrPayload(raw)).toBeNull();
  });
});
