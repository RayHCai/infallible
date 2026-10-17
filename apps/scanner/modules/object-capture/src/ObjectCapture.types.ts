import type { CapturedFrame, Pose } from '../../../src/api/driver';

export interface CaptureOptions {
  /** Upper bound on images kept from the session. */
  maxFrames: number;
  /** Run PhotogrammetrySession on-device when the hardware supports it. */
  reconstructOnDevice: boolean;
}

export interface CaptureResult {
  frames: CapturedFrame[];
  poses: Pose[];
  /** Metres per unit from ARKit, when known. */
  scaleM: number | null;
  /** On-device USDZ, when PhotogrammetrySession ran. */
  meshUri: string | null;
}
