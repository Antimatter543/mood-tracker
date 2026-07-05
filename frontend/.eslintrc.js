// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: 'expo',
  ignorePatterns: ['/dist/*'],
  rules: {
    // eslint-config-expo 56 bundles eslint-plugin-react-hooks 7.x, which adds
    // React Compiler rules as errors by default. We do not compile with the
    // React Compiler, and these fire on patterns that are correct here:
    //   - immutability: Reanimated shared-value (`.value =`) mutation, and
    //     test helpers that capture a hook's return into a ref/box.
    //   - set-state-in-effect: deliberate prop-to-state sync and async (post-
    //     await) data loads kicked off from a mount effect.
    //   - refs: the "latest ref" pattern — updating `ref.current` during render
    //     so a non-memoized async callback (DBViewer's fetchEntriesPage /
    //     loadMoreData) reads the CURRENT filter without stale closures. The ref
    //     is only READ inside those callbacks, never for render output, so the
    //     render-time write is safe (and strictly more correct than an effect,
    //     which would lag a frame behind the loader it feeds).
    // Keep them as warnings (visible signal, not a gate failure) until a
    // dedicated React Compiler adoption pass. Matches the project's prior
    // "0 errors, warnings OK" lint baseline.
    'react-hooks/immutability': 'warn',
    'react-hooks/set-state-in-effect': 'warn',
    'react-hooks/refs': 'warn',
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
    {
      // Jest tests that live alongside the CommonJS scripts (e.g. the
      // demo-data generator's round-trip test). The scripts override above gives
      // them the node env; they ALSO need the jest globals (describe/it/expect)
      // — eslint-config-expo only injects those for its default test glob, not
      // for files matched by our scripts override. Declare both here. (Ordered
      // after the scripts override so it wins for these files.)
      files: ['scripts/**/__tests__/**/*.js', 'scripts/**/*.test.js'],
      env: { node: true, jest: true },
    },
  ],
};
