import type { BuildAccepted } from '@infallible/contracts';

export interface CapturedFrame {
  uri: string;
  mimeType: string;
}

/** Device orientation (radians) at the moment a frame was taken. */
export interface Pose {
  alpha: number;
  beta: number;
  gamma: number;
  t: number;
}

export interface CapturePayload {
  runId: string;
  frames: CapturedFrame[];
  poses?: Pose[];
  scaleM?: number;
  mesh?: { uri: string; mimeType: string };
}

/** React Native's FormData accepts {uri, name, type} file descriptors. */
type RNFile = { uri: string; name: string; type: string };
const asFile = (f: RNFile) => f as unknown as Blob;

export function buildCaptureForm(p: CapturePayload): FormData {
  const form = new FormData();
  form.append('run_id', p.runId);
  p.frames.forEach((f, i) => {
    const ext = f.mimeType === 'image/png' ? 'png' : 'jpg';
    form.append('frames', asFile({ uri: f.uri, name: `frame_${i}.${ext}`, type: f.mimeType }));
  });
  if (p.poses?.length) form.append('poses', JSON.stringify(p.poses));
  if (p.scaleM !== undefined) form.append('scale', String(p.scaleM));
  if (p.mesh) form.append('mesh', asFile({ uri: p.mesh.uri, name: 'mesh', type: p.mesh.mimeType }));
  return form;
}

export async function uploadCapture(driverUrl: string, p: CapturePayload): Promise<BuildAccepted> {
  const res = await fetch(`${driverUrl}/build`, { method: 'POST', body: buildCaptureForm(p) });
  if (!res.ok) {
    throw new Error(`driver rejected capture (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as BuildAccepted;
}
