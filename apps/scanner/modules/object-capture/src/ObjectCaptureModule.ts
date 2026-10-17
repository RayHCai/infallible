import { requireOptionalNativeModule } from 'expo';

import type { CaptureOptions, CaptureResult } from './ObjectCapture.types';

interface NativeObjectCapture {
  isSupported(): boolean;
  startCapture(options: CaptureOptions): Promise<CaptureResult>;
}

// Optional: absent in Expo Go / web / before `expo prebuild`, so the app
// degrades to the guided expo-camera capture instead of crashing.
const native = requireOptionalNativeModule<NativeObjectCapture>('ObjectCapture');

export const ObjectCapture = {
  /** True on iOS 17+ devices where RealityKit ObjectCaptureSession is supported (LiDAR). */
  isSupported(): boolean {
    return native?.isSupported() ?? false;
  },
  startCapture(options: CaptureOptions): Promise<CaptureResult> {
    if (!native) return Promise.reject(new Error('ObjectCapture native module not available'));
    return native.startCapture(options);
  },
};
