import type {
  Agent,
  BuildAccepted,
  ConnectResponse,
  Device,
  MeshAnnotations,
  Persona,
  Run,
  StartResponse,
  SuggestionsFile,
  Task,
} from '@infallible/contracts';

import { DRIVER_URL } from '../config';

export class DriverError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriverError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const res = await fetch(`${DRIVER_URL}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: unknown };
    throw new DriverError(
      res.status,
      typeof body.detail === 'string' ? body.detail : res.statusText,
    );
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

export const driver = {
  start: () => post<StartResponse>('/start'),
  stop: (runId: string) => post<Run>('/stop', { run_id: runId }),
  skipScan: (runId: string) => post<BuildAccepted>(`/runs/${runId}/skip-scan`),
  connect: (deviceId: string | null = null) =>
    post<ConnectResponse>('/connect', { device_id: deviceId }),
  devices: () => request<Device[]>('/devices'),
  agents: (runId: string) => request<Agent[]>(`/runs/${runId}/agents`),
  annotations: (runId: string) => request<MeshAnnotations>(`/runs/${runId}/mesh/annotations`),
  suggestions: (runId: string) => request<SuggestionsFile>(`/runs/${runId}/suggestions`),
  personas: () => request<Persona[]>('/personas'),
  tasks: () => request<Task[]>('/tasks'),
  meshUrl: (runId: string) => `${DRIVER_URL}/runs/${runId}/mesh`,
};
