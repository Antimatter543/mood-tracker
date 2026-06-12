// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: 'expo',
  ignorePatterns: ['/dist/*'],
  rules: {
    // eslint-config-expo 56 bundles eslint-plugin-react-hooks 7.x, which adds
    // React Compiler rules as errors by default. We do not compile with the
    // React Compiler, and these two fire on patterns that are correct here:
    //   - immutability: Reanimated shared-value (`.value =`) mutation, and
    //     test helpers that capture a hook's return into a ref/box.
    //   - set-state-in-effect: deliberate prop-to-state sync and async (post-
    //     await) data loads kicked off from a mount effect.
    // Keep them as warnings (visible signal, not a gate failure) until a
    // dedicated React Compiler adoption pass. Matches the project's prior
    // "0 errors, warnings OK" lint baseline.
    'react-hooks/immutability': 'warn',
    'react-hooks/set-state-in-effect': 'warn',
  },
  overrides: [
    {
      // CommonJS Node tooling scripts (build/release). They legitimately use
      // node globals (__dirname, require, module, process); declare the node
      // env so no-undef doesn't flag them. eslint-config-expo 56 no longer
      // assumes a node env for these by default.
      files: ['scripts/**/*.js', 'plugins/**/*.js', '*.config.js'],
      env: { node: true },
    },
  ],
};
