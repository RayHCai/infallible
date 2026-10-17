// Config plugin for the local object-capture module. Runs at `expo prebuild`.
const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const LOCAL_NETWORK_REASON =
  'Connects to the Infallible driver on your local network to upload the pump capture.';

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withObjectCapture = (config) => {
  config = withInfoPlist(config, (cfg) => {
    // iOS 14+ prompts before talking to LAN hosts (the driver).
    cfg.modResults.NSLocalNetworkUsageDescription ??= LOCAL_NETWORK_REASON;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    // ARCore is used opportunistically for depth-assisted capture; never required.
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.ar.core', 'optional');
    return cfg;
  });

  return config;
};

module.exports = withObjectCapture;
