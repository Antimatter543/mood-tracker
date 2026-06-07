// plugins/withReleaseAbis.js
//
// Config plugin: build native libraries only for real-device CPU ABIs.
//
// EAS ships a universal APK with all 4 ABIs by default (armeabi-v7a,
// arm64-v8a, x86, x86_64). The two x86 ABIs are emulator-only and never run
// on real phones, yet they account for ~44 MB of the APK (the same .so libs
// duplicated per ABI). Restricting `reactNativeArchitectures` to the two ARM
// ABIs drops those libs from the build with zero impact on real devices:
// arm64-v8a covers every 64-bit phone (~2017+), armeabi-v7a covers old 32-bit
// devices.
//
// Set via gradle.properties so it persists through EAS's cloud prebuild
// (android/ is managed/regenerated, so editing build.gradle directly would
// not survive).

const { withGradleProperties } = require('@expo/config-plugins');

const ABIS = 'armeabi-v7a,arm64-v8a';

module.exports = function withReleaseAbis(config) {
  return withGradleProperties(config, (cfg) => {
    const props = cfg.modResults;
    const entry = { type: 'property', key: 'reactNativeArchitectures', value: ABIS };
    const i = props.findIndex(
      (p) => p.type === 'property' && p.key === 'reactNativeArchitectures'
    );
    if (i >= 0) props[i] = entry;
    else props.push(entry);
    return cfg;
  });
};
