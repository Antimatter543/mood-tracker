/**
 * testIDs for the five bottom-tab buttons, keyed by expo-router route name.
 *
 * Android exposes a testID as the view's resource-id, which is what Maestro's
 * `tapOn: id:` matches. The tab bar's own labels are NOT reachable by Maestro
 * (react-navigation renders them inside the button's a11y node), so before
 * these existed every flow tapped tabs by screen percentage (`point: 30%, 89%`),
 * which silently drifts with screen size, nav mode and tab-bar height.
 *
 * The Maestro flow lint (`__tests__/maestroFlowLint.test.ts`) reads this map:
 * a flow that taps a `tab-*` id missing from here fails without a device.
 */
export const TAB_BUTTON_TEST_IDS = {
    index: 'tab-home',
    periodwindow: 'tab-periodwindow',
    stats: 'tab-stats',
    timeline: 'tab-timeline',
    insights: 'tab-insights',
    settings: 'tab-settings',
} as const;

export type TabRouteName = keyof typeof TAB_BUTTON_TEST_IDS;
