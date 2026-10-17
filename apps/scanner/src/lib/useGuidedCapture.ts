import type { CameraView } from 'expo-camera';
import { DeviceMotion } from 'expo-sensors';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { CapturedFrame, Pose } from '../api/driver';

export interface GuidedCaptureOptions {
  frames: number;
  intervalMs: number;
}

export interface GuidedCaptureResult {
  frames: CapturedFrame[];
  poses: Pose[];
}

export type GuidedCaptureState =
  | { status: 'idle' }
  | { status: 'capturing'; taken: number }
  | ({ status: 'done' } & GuidedCaptureResult)
  | { status: 'error'; message: string };

/**
 * Android / non-LiDAR path: timed orbit capture with expo-camera while
 * DeviceMotion records the phone's orientation for each frame. The driver
 * reconstructs the mesh server-side.
 */
export function useGuidedCapture(
  camera: RefObject<CameraView | null>,
  { frames, intervalMs }: GuidedCaptureOptions,
) {
  const [state, setState] = useState<GuidedCaptureState>({ status: 'idle' });
  const pose = useRef<Pose>({ alpha: 0, beta: 0, gamma: 0, t: 0 });
  const cancelled = useRef(false);

  useEffect(() => {
    DeviceMotion.setUpdateInterval(50);
    const sub = DeviceMotion.addListener(({ rotation }) => {
      pose.current = { ...rotation, t: Date.now() };
    });
    return () => {
      cancelled.current = true;
      sub.remove();
    };
  }, []);

  /** Resolves with the capture, or null on error (state carries the message). */
  const start = useCallback(async (): Promise<GuidedCaptureResult | null> => {
    cancelled.current = false;
    const taken: CapturedFrame[] = [];
    const poses: Pose[] = [];
    setState({ status: 'capturing', taken: 0 });
    try {
      for (let i = 0; i < frames && !cancelled.current; i++) {
        const photo = await camera.current?.takePictureAsync({
          quality: 0.7,
          skipProcessing: true,
        });
        if (photo) {
          taken.push({ uri: photo.uri, mimeType: 'image/jpeg' });
          poses.push({ ...pose.current });
          setState({ status: 'capturing', taken: taken.length });
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      setState({ status: 'done', frames: taken, poses });
      return { frames: taken, poses };
    } catch (err) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }, [camera, frames, intervalMs]);

  const reset = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, start, reset };
}
