/**
 * `react-native-chart-kit` is gone and stays gone.
 *
 * Every chart in this app is our own thin react-native-svg renderer over pure,
 * unit-tested geometry. The library was dropped on purpose, not as a verdict on
 * it: the 6.x LineChart drew one flat stroke whatever the value, overshot the
 * data range with its bezier, exposed no touch stream a hold-to-scrub can sit
 * on, and sized itself from `Dimensions.get('window')`. A new chart that pulls
 * it back in would reintroduce all of that, and look fine in review.
 *
 * Source-scan verdict (lane D): the old "no file imports it" scan was DELETED.
 * A dependency ban is enforced by the dependency list: with the package absent,
 * any import fails `tsc --noEmit` (TS2307) and the Metro bundle, both CI gates.
 * What is left is the one thing those need, the package staying out of
 * package.json.
 */
import { readSource } from '@/testing/sourceScan';

const CHART_KIT = 'react-native-chart-kit';

describe('react-native-chart-kit is gone and stays gone', () => {
    it('is not a dependency any more', () => {
        const pkg = JSON.parse(readSource('package.json'));
        expect(pkg.dependencies?.[CHART_KIT]).toBeUndefined();
        expect(pkg.devDependencies?.[CHART_KIT]).toBeUndefined();
    });
});
