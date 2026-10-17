import { CameraView } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ObjectCapture } from '../modules/object-capture';
import type { CapturePayload } from '../src/api/driver';
import { useGuidedCapture } from '../src/lib/useGuidedCapture';
import { Page } from '../src/ui/Page';
import { Shutter } from '../src/ui/Shutter';
import { colors, radius } from '../src/ui/theme';

const GUIDED_FRAMES = 48;
const GUIDED_INTERVAL_MS = 350;

export default function CaptureScreen() {
  const router = useRouter();
  const { run_id: runId } = useLocalSearchParams<{
    run_id: string;
    driver_url: string;
  }>();
  const camera = useRef<CameraView>(null);
  const guided = useGuidedCapture(camera, {
    frames: GUIDED_FRAMES,
    intervalMs: GUIDED_INTERVAL_MS,
  });
  const [uploading, setUploading] = useState(false);
  const [failed, setFailed] = useState(false);

  // Not wired yet: the capture is dropped instead of `uploadCapture(driverUrl, payload)`.
  const send = async (_payload: CapturePayload) => {
    setUploading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 800));
      router.replace('/sent');
    } catch {
      setFailed(true);
    } finally {
      setUploading(false);
    }
  };

  // One tap: iOS LiDAR devices get RealityKit Object Capture, everything else
  // the timed expo-camera orbit. Either result is sent without confirmation.
  const capture = async () => {
    setFailed(false);
    if (!ObjectCapture.isSupported()) {
      const result = await guided.start();
      if (result) await send({ runId, ...result });
      return;
    }
    try {
      const result = await ObjectCapture.startCapture({ maxFrames: 80, reconstructOnDevice: true });
      await send({
        runId,
        frames: result.frames,
        poses: result.poses,
        ...(result.scaleM !== null ? { scaleM: result.scaleM } : {}),
        ...(result.meshUri
          ? { mesh: { uri: result.meshUri, mimeType: 'model/vnd.usdz+zip' } }
          : {}),
      });
    } catch {
      setFailed(true);
    }
  };

  const { state } = guided;
  return (
    <Page>
      <View style={styles.frame}>
        <CameraView ref={camera} style={styles.fill} facing="back" />
      </View>
      <Shutter
        progress={state.status === 'capturing' ? state.taken / GUIDED_FRAMES : null}
        busy={uploading}
        failed={failed || state.status === 'error'}
        onPress={() => void capture()}
      />
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  frame: {
    width: '100%',
    flex: 1,
    borderRadius: radius,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
});
