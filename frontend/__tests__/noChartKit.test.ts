/**
 * CLASS-LEVEL INVARIANT: no app source imports `react-native-chart-kit`.
 *
 * Every chart in this app is now our own thin react-native-svg renderer over
 * pure, unit-tested geometry. chart-kit is unmaintained; it drew one flat
 * stroke whatever the value, overshot the data range with its bezier, offered
 * no interaction, and sized itself from `Dimensions.get('window')` instead of
 * measuring. Those are the exact defects the replacement exists to fix, so a
 * `import { LineChart } from 'react-native-chart-kit'` sneaking back into a NEW
 * chart would silently reintroduce all of them — and would look perfectly fine
 * in review, because it is one familiar-looking line.
 *
 * The dependency itself is also gone from package.json, so such an import would
 * fail at bundle time rather than at review time — but that failure would be a
 * confusing "module not found" in Metro. This says what the rule actually is.
 *
 * Sibling of softDeleteExclusion.test.ts / pageHeaderUniformity.test.ts: the
 * defect is the DIFFERENCE between files, which only a test that enumerates
 * them all can see.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

/** Everywhere a chart could plausibly live. */
const SCANNED_DIRS = ['app', 'components', 'context', 'hooks', 'lib'];

const CHART_KIT = 'react-native-chart-kit';
/** An IMPORT of it, not a mention of the name in a comment explaining why. */
const IMPORTS_CHART_KIT =
    /(?:from\s+['"]react-native-chart-kit['"]|require\(\s*['"]react-native-chart-kit['"]\s*\))/;

const SOURCE_EXT = /\.tsx?$/;

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const name of readdirSync(d)) {
            const full = join(d, name);
            if (statSync(full).isDirectory()) {
                if (name === 'node_modules' || name === '__tests__') continue;
                walk(full);
            } else if (SOURCE_EXT.test(name)) {
                out.push(full);
            }
        }
    };
    walk(dir);
    return out;
}

const allFiles = SCANNED_DIRS.flatMap((d) => sourceFiles(join(ROOT, d)));

describe('react-native-chart-kit is gone and stays gone', () => {
    it('scans a non-trivial number of files (guards against a vacuous pass)', () => {
        // If the walker silently found nothing, every assertion below would be
        // trivially true forever.
        expect(allFiles.length).toBeGreaterThan(50);
    });

    it('no app source imports it', () => {
        const offenders = allFiles.filter((f) =>
            IMPORTS_CHART_KIT.test(readFileSync(f, 'utf8'))
        );
        expect(offenders.map((f) => f.replace(`${ROOT}/`, ''))).toEqual([]);
    });

    it('the regex really does catch an import (proves the check has teeth)', () => {
        expect(IMPORTS_CHART_KIT.test(`import { LineChart } from '${CHART_KIT}';`)).toBe(true);
        expect(IMPORTS_CHART_KIT.test(`const { BarChart } = require("${CHART_KIT}")`)).toBe(true);
        // A comment naming it is fine — this file and several others do.
        expect(IMPORTS_CHART_KIT.test(`// replaces ${CHART_KIT}'s LineChart`)).toBe(false);
    });

    it('is not a dependency any more', () => {
        const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
        expect(pkg.dependencies?.[CHART_KIT]).toBeUndefined();
        expect(pkg.devDependencies?.[CHART_KIT]).toBeUndefined();
    });
});
