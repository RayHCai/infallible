import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Infallible Scanner',
  slug: 'infallible-scanner',
  scheme: 'infallible',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'com.infallible.scanner',
    supportsTablet: false,
  },
  android: {
    package: 'com.infallible.scanner',
  },
  plugins: [
    'expo-router',
    [
      'expo-camera',
      {
        cameraPermission: 'The camera scans the run QR code and captures the pump.',
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-sensors',
      { motionPermission: 'Device motion records camera poses while capturing the pump.' },
    ],
    [
      'expo-build-properties',
      // The driver runs on the local network over plain HTTP during demos.
      { android: { usesCleartextTraffic: true } },
    ],
    './modules/object-capture/app.plugin.js',
  ],
});
