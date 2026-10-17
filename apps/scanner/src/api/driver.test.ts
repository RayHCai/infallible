import { buildCaptureForm } from './driver';

/** React Native's FormData exposes getParts(); the WHATWG one (jest) exposes keys(). */
function fieldNames(form: FormData): string[] {
  const rn = form as unknown as { getParts?: () => { fieldName: string }[] };
  if (typeof rn.getParts === 'function') return rn.getParts().map((p) => p.fieldName);
  return [...(form as unknown as { keys(): Iterable<string> }).keys()];
}

describe('buildCaptureForm', () => {
  it('encodes frames, poses and scale as multipart fields', () => {
    const form = buildCaptureForm({
      runId: 'run-1',
      frames: [
        { uri: 'file:///a.jpg', mimeType: 'image/jpeg' },
        { uri: 'file:///b.png', mimeType: 'image/png' },
      ],
      poses: [{ alpha: 0, beta: 0.1, gamma: 0.2, t: 1 }],
      scaleM: 0.08,
    });

    expect(fieldNames(form)).toEqual(['run_id', 'frames', 'frames', 'poses', 'scale']);
  });
});
