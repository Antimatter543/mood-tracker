/**
 * Maestro flow lint: every flow in `.maestro/` targets the app that actually
 * ships, taps tabs (and anything else with a testID) by id rather than by
 * screen percentage, and only names ids the app can render. Runs in the PR gate,
 * no device needed; the emulator run (.github/workflows/e2e.yml) is the slow,
 * expensive place to learn any of this.
 *
 * Bug: every flow had `appId: com.raeduslabs.soulsync`, a package that does not
 * exist (the app is `com.raeduslabs.soulsyncapp`, app.json `expo.android.package`),
 * and tabs were tapped by `point: 30%, 89%`. Rules and their rationale:
 * testing/maestroFlowLint.ts. Source-scan verdict: KEEP; YAML flows have no
 * compiler, so this lint IS their type check.
 */
import { readdirSync } from 'fs';
import { posix } from 'path';
import { APP_ROOT, code, listAppFiles, listSourceFiles, readSource } from '@/testing/sourceScan';
import {
    bashList,
    flowAppId,
    flowEnvValues,
    flowFileRefs,
    flowIds,
    flowOpenLinks,
    flowScreenshots,
    idIsKnown,
    shotsWithoutSettle,
    sourceTestIds,
    unjustifiedPointTaps,
} from '@/testing/maestroFlowLint';
import { SETTINGS_REGISTRY } from '@/databases/settings';
import { TAB_BUTTON_TEST_IDS } from '@/lib/tabTestIds';
import { isSeedLink, parseSeedLink } from '@/lib/qa/seedLink';

/** The ONE source of the package name: app.json. Never hand-typed here. */
const APP_ID: string = JSON.parse(readSource('app.json')).expo.android.package;

const FLOWS = listAppFiles(['.maestro'], name => /\.ya?ml$/.test(name));

const KNOWN_IDS: ReadonlySet<string> = new Set([
    ...Object.values(TAB_BUTTON_TEST_IDS),
    ...listSourceFiles(['app', 'components', 'context', 'lib']).flatMap(f => sourceTestIds(code(f))),
]);

/** Every smoke flow's first runFlow: fresh install + QA seed + frozen clock. */
const LAUNCH_REF = 'subflows/launch.yaml';
const LAUNCH = `.maestro/smoke/${LAUNCH_REF}`;

/**
 * Why a flow's seed link would not do what the flow assumes, or null. The app's
 * own parser decides (a link it rejects shows "QA seed: error ..." and the flow
 * times out on CI, 20 minutes later); `now` must be set, or "today" is the
 * runner's real date and the flow is not deterministic.
 */
function seedLinkProblem(link: string): string | null {
    const parsed = parseSeedLink(link);
    if (!parsed.ok) return `rejected: ${parsed.error}`;
    return parsed.command.now ? null : 'no now= (the app clock would not be frozen)';
}

/**
 * The golden set: flows in .maestro/goldens/, and which device config runs which, as
 * scripts/e2e-goldens.sh declares it. A flow nobody lists is a screen we think is
 * guarded and is not; two flows writing one name in a config overwrite each other,
 * so the golden shows only the later screen.
 */
const GOLDENS_SCRIPT = readSource('scripts/e2e-goldens.sh');
const GOLDEN_CONFIGS = bashList(GOLDENS_SCRIPT, 'GOLDEN_CONFIGS');
const goldenFlowsOf = (script: string, config: string) =>
    bashList(script, `GOLDEN_FLOWS_${config.replace(/-/g, '_')}`);
const goldenFlowFile = (name: string) => `.maestro/goldens/${name}.yaml`;
const GOLDEN_FLOWS = FLOWS.filter(f => posix.dirname(f) === '.maestro/goldens');
const SETTLE_REF = 'subflows/settle.yaml';
const SMOKE_LAUNCH_REF = '../smoke/subflows/launch.yaml';

/** Why a golden flow's opening would make its first shot unreliable, or null. */
function goldenOpeningProblem(text: string): string | null {
    const [first, second] = flowFileRefs(text);
    if (first !== SMOKE_LAUNCH_REF) return `first runFlow is ${first ?? '(none)'}, not ${SMOKE_LAUNCH_REF}`;
    if (second !== SETTLE_REF) return `second runFlow is ${second ?? '(none)'}, not ${SETTLE_REF} (the seed pill would be in the shot)`;
    return null;
}

/** Why a set of image names (one device config) cannot be a golden set, or null. */
function goldenNameProblem(names: string[]): string | null {
    const dup = names.find((n, i) => names.indexOf(n) !== i);
    if (dup) return `"${dup}" is taken twice: the later shot overwrites the earlier`;
    const bad = names.find(n => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n));
    if (bad !== undefined) return `"${bad}" is not kebab-case (it is a file name and a budget key)`;
    if (names.includes('seed-retry')) return '"seed-retry" is launch.yaml\'s retry marker, and the harness drops it';
    return null;
}

const TABS_FLOW = 'tabs-week';

/** Tab testIDs a flow never taps. */
function tabsMissingFromFlow(text: string, tabs: readonly string[]): string[] {
    const tapped = new Set(flowIds(text).map(i => i.id));
    return tabs.filter(t => !tapped.has(t));
}

/** Every lint error for one flow. Empty = clean. */
function lintFlow(rel: string, text: string, appId: string, known: ReadonlySet<string>): string[] {
    const errors: string[] = [];
    const id = flowAppId(text);
    if (id !== appId) errors.push(`${rel}: appId is ${id ?? '(missing)'}, the app ships as ${appId}`);
    for (const line of unjustifiedPointTaps(text)) {
        errors.push(
            `${rel}:${line}: tap by point. Use \`id:\` (tabs: tab-home/tab-stats/...), or justify it ` +
                'with "# e2e-lint: point-ok <reason>" when no element exists to target',
        );
    }
    for (const { id: sel, line } of flowIds(text)) {
        if (!idIsKnown(sel, known)) errors.push(`${rel}:${line}: id "${sel}" is not a testID the app renders`);
    }
    return errors;
}

describe('Maestro flows (.maestro/)', () => {
    it('finds the flows, including the smoke set', () => {
        expect(FLOWS.length).toBeGreaterThan(0);
        expect(FLOWS.some(f => f.startsWith('.maestro/smoke/'))).toBe(true);
    });

    it('reads the package name from app.json, and no app.config.* can override it', () => {
        expect(APP_ID).toMatch(/^[a-z][\w]*(\.[a-z][\w]*)+$/);
        // A dynamic config would make app.json a lie; derive APP_ID from it instead.
        expect(readdirSync(APP_ROOT).filter(n => /^app\.config\./.test(n))).toEqual([]);
    });

    it.each(FLOWS)('%s: right appId, no point taps, only real ids', rel => {
        expect(lintFlow(rel, readSource(rel), APP_ID, KNOWN_IDS)).toEqual([]);
    });

    it.each(FLOWS)('%s: every runFlow file exists', rel => {
        for (const ref of flowFileRefs(readSource(rel))) {
            const target = posix.normalize(posix.join(posix.dirname(rel), ref));
            expect(() => readSource(target)).not.toThrow();
        }
    });

    it('scripts/e2e-smoke.sh runs exactly the flows in .maestro/smoke (no orphan, no missing file)', () => {
        const listed = bashList(readSource('scripts/e2e-smoke.sh'), 'SMOKE_FLOWS');
        const onDisk = FLOWS.filter(f => posix.dirname(f) === '.maestro/smoke').map(f =>
            posix.basename(f).replace(/\.ya?ml$/, ''),
        );
        expect(listed.length).toBeGreaterThan(0);
        expect([...listed].sort()).toEqual(onDisk);
    });

    it('every smoke flow starts from the launch subflow (fresh state, seed, frozen clock)', () => {
        const smoke = FLOWS.filter(f => posix.dirname(f) === '.maestro/smoke');
        for (const rel of smoke) expect([rel, flowFileRefs(readSource(rel))[0]]).toEqual([rel, LAUNCH_REF]);
    });

    it('the seed link each flow builds parses with the app parser, with a frozen now', () => {
        const scenarios = [...new Set(FLOWS.flatMap(f => flowEnvValues(readSource(f), 'SCENARIO')))];
        expect(scenarios.length).toBeGreaterThan(0);
        // The first attempt and its one retry open the SAME link: a retry that
        // seeded something else would pass the flow on different data.
        const templates = flowOpenLinks(readSource(LAUNCH));
        expect(templates.length).toBeGreaterThan(0);
        expect(new Set(templates).size).toBe(1);
        expect(templates[0]).toContain('${SCENARIO}');
        for (const scenario of scenarios) {
            expect([scenario, seedLinkProblem(templates[0].replace('${SCENARIO}', scenario))]).toEqual([scenario, null]);
        }
        // Any literal seed link elsewhere obeys the same rule.
        for (const rel of FLOWS) {
            for (const link of flowOpenLinks(readSource(rel)).filter(l => !l.includes('${'))) {
                if (isSeedLink(link)) expect([rel, seedLinkProblem(link)]).toEqual([rel, null]);
            }
        }
    });

    describe('golden flows', () => {
        it('finds the configs and flows it is about to check', () => {
            expect(GOLDEN_CONFIGS.length).toBeGreaterThan(1);
            expect(GOLDEN_FLOWS.length).toBeGreaterThan(0);
        });

        it('every golden flow runs on some device config, and every listed flow has a file', () => {
            const listed = new Set(GOLDEN_CONFIGS.flatMap(c => goldenFlowsOf(GOLDENS_SCRIPT, c)));
            expect([...listed].map(goldenFlowFile).sort()).toEqual(GOLDEN_FLOWS);
        });

        it.each(GOLDEN_FLOWS)('%s: seeds, then settles, before anything else', rel => {
            expect(goldenOpeningProblem(readSource(rel))).toBeNull();
        });

        it.each(GOLDEN_FLOWS)('%s: takes a screenshot, each one after waitForAnimationToEnd', rel => {
            const text = readSource(rel);
            expect(flowScreenshots(text).length).toBeGreaterThan(0);
            expect(shotsWithoutSettle(text)).toEqual([]);
        });

        it.each(GOLDEN_CONFIGS)('config %s: image names are unique, kebab-case file names', config => {
            const names = goldenFlowsOf(GOLDENS_SCRIPT, config).flatMap(f =>
                flowScreenshots(readSource(goldenFlowFile(f))).map(s => s.name),
            );
            expect(names.length).toBeGreaterThan(0);
            expect(goldenNameProblem(names)).toBeNull();
        });

        // A new tab must join this flow, or the tab-header goldens silently stop being
        // about every tab (this replaced the pageHeaderUniformity source scan).
        it('tabs-week visits every tab and shoots each one, on every device config', () => {
            const text = readSource(goldenFlowFile(TABS_FLOW));
            const tabs = Object.values(TAB_BUTTON_TEST_IDS);
            expect(tabsMissingFromFlow(text, tabs)).toEqual([]);
            expect(flowScreenshots(text).map(s => s.name).sort()).toEqual(tabs.slice().sort());
            for (const config of GOLDEN_CONFIGS) {
                expect([config, goldenFlowsOf(GOLDENS_SCRIPT, config).includes(TABS_FLOW)]).toEqual([config, true]);
            }
        });

        it('every THEME a flow sets is an option of the theme setting', () => {
            const themes = FLOWS.flatMap(f => flowEnvValues(readSource(f), 'THEME'));
            expect(themes.length).toBeGreaterThan(0);
            const options: string[] = SETTINGS_REGISTRY.theme.options.map(o => o.value);
            expect(themes.filter(t => !options.includes(t))).toEqual([]);
        });
    });

    it('every tab route carries its tab-* testID in the tab layout', () => {
        const layout = code('app/(tabs)/_layout.tsx');
        const screens = [...layout.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map(m => m[1]);
        expect(screens.sort()).toEqual(Object.keys(TAB_BUTTON_TEST_IDS).sort());
        for (const route of screens) {
            expect(layout).toContain(`tabBarButtonTestID: TAB_BUTTON_TEST_IDS.${route}`);
        }
    });
});

// The rules against the exact inputs they exist to catch. If one of these goes
// green on a bad input, the per-flow checks above are vacuous.
describe('flow lint rules (counterfactuals)', () => {
    const known = new Set(['tab-home', 'entry-delete', 'bin-restore-X']);
    const flow = (appId: string, body: string) => `appId: ${appId}\n---\n- launchApp\n${body}`;

    it('fails the old appId the flows used to carry', () => {
        const errors = lintFlow('old.yaml', flow('com.raeduslabs.soulsync', ''), APP_ID, known);
        expect(errors).toEqual([expect.stringContaining('appId is com.raeduslabs.soulsync')]);
        expect(lintFlow('new.yaml', flow(APP_ID, ''), APP_ID, known)).toEqual([]);
    });

    it('fails a flow with no appId', () => {
        expect(lintFlow('x.yaml', '- launchApp\n', APP_ID, known)).toEqual([
            expect.stringContaining('appId is (missing)'),
        ]);
    });

    it('fails a tab tapped by point, passes it by id or with a justified point-ok', () => {
        expect(unjustifiedPointTaps(flow(APP_ID, '- tapOn:\n    point: 30%, 89%\n'))).toEqual([5]);
        expect(unjustifiedPointTaps(flow(APP_ID, '- tapOn: { point: "30%, 89%" }\n'))).toEqual([4]);
        expect(unjustifiedPointTaps(flow(APP_ID, '- tapOn:\n    id: tab-stats\n'))).toEqual([]);
        expect(
            unjustifiedPointTaps(flow(APP_ID, '# e2e-lint: point-ok (inset strip)\n- tapOn:\n    point: 10%, 99%\n')),
        ).toEqual([]);
        // A bare marker with no reason does not count.
        expect(unjustifiedPointTaps(flow(APP_ID, '# e2e-lint: point-ok\n- tapOn:\n    point: 10%, 99%\n'))).toEqual([6]);
        // Swipe coordinates are not taps.
        expect(unjustifiedPointTaps(flow(APP_ID, '- swipe:\n    start: 50%, 80%\n    end: 50%, 20%\n'))).toEqual([]);
    });

    it('accepts one value of a template and a flow variable in its hole, and nothing wider', () => {
        expect(idIsKnown('bin-restore-42', known)).toBe(true);
        expect(idIsKnown('bin-purge-42', known)).toBe(false);
        expect(idIsKnown('bin-restore-', known)).toBe(false);
        expect(idIsKnown('bin-restore-${ID}', known)).toBe(true);
        expect(idIsKnown('bin-purge-${ID}', known)).toBe(false);
        // A sample that is all holes must not vouch for everything.
        expect(idIsKnown('anything-at-all', new Set(['X']))).toBe(false);
        expect(idIsKnown('anything-at-all', new Set(['XX']))).toBe(false);
    });

    it('fails an id the app does not render, accepts literal and regex ids that it does', () => {
        expect(idIsKnown('entry-delete', known)).toBe(true);
        expect(idIsKnown('entry-delte', known)).toBe(false);
        expect(idIsKnown('bin-restore-.*', known)).toBe(true);
        expect(idIsKnown('bin-purge-.*', known)).toBe(false);
        expect(lintFlow('x.yaml', flow(APP_ID, '- tapOn:\n    id: "tab-hom"\n'), APP_ID, known)).toEqual([
            expect.stringContaining('id "tab-hom"'),
        ]);
    });

    it('reads literal, template and object-style testIDs from source', () => {
        const src = 'testID="a-b" testID={\'c\'} testID={`bin-restore-${item.id}`} { testID: "d" }';
        expect(sourceTestIds(src)).toEqual(['a-b', 'c', 'bin-restore-X', 'd']);
    });

    it('rejects a seed link the app would refuse or that leaves the clock running', () => {
        const at = '2026-11-03T10:00:00Z';
        expect(seedLinkProblem(`myapp://qa/seed?scenario=week&now=${at}`)).toBeNull();
        expect(seedLinkProblem(`myapp://qa/seed?scenario=weeks&now=${at}`)).toBe('rejected: unknown-scenario');
        // A local time (no Z) is not a strict UTC instant.
        expect(seedLinkProblem('myapp://qa/seed?scenario=week&now=2026-11-03T10:00:00')).toBe('rejected: bad-now');
        expect(seedLinkProblem('myapp://qa/seed?scenario=week')).toContain('no now=');
    });

    it('reads openLink targets and runFlow env values', () => {
        const text = '- openLink: "myapp://x?a=${S}"  # why\n- runFlow:\n    file: f.yaml\n    env:\n      SCENARIO: week\n# SCENARIO: nope\n';
        expect(flowOpenLinks(text)).toEqual(['myapp://x?a=${S}']);
        expect(flowEnvValues(text, 'SCENARIO')).toEqual(['week']);
    });

    it('parses a bash list by name', () => {
        const script = 'X=1\nSMOKE_FLOWS=(\n  01-a\n  02-b # why\n)\nOTHER=(\n  c\n)\n';
        expect(bashList(script, 'SMOKE_FLOWS')).toEqual(['01-a', '02-b']);
        expect(bashList(script, 'OTHER')).toEqual(['c']);
        expect(bashList(script, 'MISSING')).toEqual([]);
    });

    it('reads both takeScreenshot forms, with their lines', () => {
        const text = '- takeScreenshot: a-b\n- takeScreenshot:\n    cropOn:\n      id: x\n    path: c-d\n- tapOn: y\n# - takeScreenshot: no\n- takeScreenshot:\n    label: only\n';
        expect(flowScreenshots(text)).toEqual([
            { name: 'a-b', line: 1 },
            { name: 'c-d', line: 2 },
            { name: '', line: 8 },
        ]);
    });

    it('fails a screenshot that does not come straight after waitForAnimationToEnd', () => {
        expect(shotsWithoutSettle('- waitForAnimationToEnd\n- takeScreenshot: a\n')).toEqual([]);
        // A comment or blank line between them changes nothing.
        expect(shotsWithoutSettle('- waitForAnimationToEnd\n# why\n\n- takeScreenshot: a\n')).toEqual([]);
        expect(shotsWithoutSettle('- tapOn: x\n- takeScreenshot: a\n')).toEqual([2]);
        expect(shotsWithoutSettle('- takeScreenshot: a\n')).toEqual([1]);
        expect(shotsWithoutSettle('- waitForAnimationToEnd\n- tapOn: x\n- takeScreenshot:\n    path: a\n')).toEqual([3]);
    });

    it('fails a golden flow that does not open with the seed, then the settle', () => {
        const run = (file: string) => `- runFlow:\n    file: ${file}\n`;
        expect(goldenOpeningProblem(run(SMOKE_LAUNCH_REF) + run(SETTLE_REF))).toBeNull();
        expect(goldenOpeningProblem(run(SETTLE_REF))).toContain('first runFlow');
        expect(goldenOpeningProblem(run(SMOKE_LAUNCH_REF))).toContain('second runFlow');
        expect(goldenOpeningProblem('- launchApp\n')).toContain('first runFlow');
    });

    it('names a tab the tabs flow forgot', () => {
        const text = '- tapOn:\n    id: tab-home\n- tapOn:\n    id: tab-stats\n';
        expect(tabsMissingFromFlow(text, ['tab-home', 'tab-stats'])).toEqual([]);
        expect(tabsMissingFromFlow(text, ['tab-home', 'tab-stats', 'tab-new'])).toEqual(['tab-new']);
    });

    it('fails image names that collide, are not file-safe, or are the retry marker', () => {
        expect(goldenNameProblem(['a', 'b-2'])).toBeNull();
        expect(goldenNameProblem(['a', 'b', 'a'])).toContain('taken twice');
        expect(goldenNameProblem(['Tab_Home'])).toContain('kebab-case');
        expect(goldenNameProblem(['goldens/a'])).toContain('kebab-case');
        expect(goldenNameProblem([''])).toContain('kebab-case');
        expect(goldenNameProblem(['seed-retry'])).toContain('retry marker');
    });
});
