import { parseQrPayload } from '@infallible/contracts';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Page } from '../src/ui/Page';
import { colors, radius } from '../src/ui/theme';

export default function ScanQrScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);

  useFocusEffect(
    useCallback(() => {
      handled.current = false;
    }, []),
  );

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const onScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (handled.current) return;
      const payload = parseQrPayload(data);
      if (!payload) return;
      handled.current = true;
      router.push({ pathname: '/capture', params: { ...payload } });
    },
    [router],
  );

  if (!permission?.granted) {
    return (
      <Page>
        {permission && !permission.canAskAgain && (
          <Pressable onPress={() => void Linking.openSettings()}>
            <Text style={styles.muted}>Allow camera access</Text>
          </Pressable>
        )}
      </Page>
    );
  }

  return (
    <Page>
      <View style={styles.frame}>
        <CameraView
          style={styles.fill}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={onScanned}
        />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  frame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius,
    overflow: 'hidden',
    backgroundColor: colors.ink,
  },
  muted: { color: colors.muted, fontSize: 16 },
});
