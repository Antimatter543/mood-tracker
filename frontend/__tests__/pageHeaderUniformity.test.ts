/**
 * CLASS-LEVEL invariant: every tab screen opens the same way.
 *
 * The bug this locks out is a layout one, so it can't be caught by rendering a
 * single screen: Insights and Timeline used to show react-navigation's own
 * header bar at the very top of the display (only Settings set
 * `headerShown: false`), and on top of that Insights drew its OWN in-page title
 * underneath while Timeline/Statistics had no in-page title at all. Three
 * different page-header shapes across five tabs, all of them type-correct and
 * all of them green under jest.
 *
 * So this test asserts the CATEGORY over the source of every screen:
 *   1. the navigator header is off for ALL tabs (set once, in shared
 *      screenOptions — not per screen),
 *   2. no screen re-enables it,
 *   3. every screen renders the shared <PageHeader/>,
 *   4. nobody re-introduces a bespoke page-title style.
 *
 * A NEW tab screen fails this suite until it adopts the convention.
 */
import fs from 'fs';
import path from 'path';

const TABS_DIR = path.join(__dirname, '..', 'app', '(tabs)');
const LAYOUT_FILE = path.join(TABS_DIR, '_layout.tsx');

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** Every screen file under app/(tabs)/ — i.e. everything but the layout. */
const screenFiles = fs
    .readdirSync(TABS_DIR)
    .filter(f => f.endsWith('.tsx') && !f.startsWith('_'))
    .sort();

describe('tab screens — uniform page header', () => {
    it('finds all five tab screens (guards against a silently renamed file)', () => {
        expect(screenFiles).toEqual([
            'index.tsx',
            'insights.tsx',
            'settings.tsx',
            'stats.tsx',
            'timeline.tsx',
        ]);
    });

    describe.each(screenFiles)('%s', file => {
        const source = read(path.join(TABS_DIR, file));

        it('imports the shared PageHeader', () => {
            expect(source).toMatch(
                /import\s*\{[^}]*\bPageHeader\b[^}]*\}\s*from\s*['"][^'"]*components\/PageHeader['"]/
            );
        });

        it('renders <PageHeader/>', () => {
            expect(source).toMatch(/<PageHeader[\s/>]/);
        });

        it('does not re-enable the navigator header', () => {
            // Only a commented-out or absent headerShown is acceptable here; the
            // real setting lives once in _layout.tsx's screenOptions.
            expect(source).not.toMatch(/^\s*headerShown\s*:\s*true/m);
        });

        it('does not define its own page-title text style', () => {
            // A 28pt/800 title style outside PageHeader is exactly how the five
            // screens drifted apart the first time.
            expect(source).not.toMatch(/globalStyles\.header/);
            expect(source).not.toMatch(/\bheadingStyle\b|\bpageTitle\b/);
        });
    });
});

describe('(tabs)/_layout.tsx — navigator header', () => {
    const layout = read(LAYOUT_FILE);

    it('turns the navigator header OFF for every tab, in shared screenOptions', () => {
        // Must live in the shared screenOptions object so it applies to all five
        // screens, not in one screen's own options.
        const screenOptions = layout.slice(
            layout.indexOf('const screenOptions'),
            layout.indexOf('return (', layout.indexOf('const screenOptions'))
        );
        expect(screenOptions).not.toHaveLength(0);
        expect(screenOptions).toMatch(/^\s*headerShown:\s*false,?\s*$/m);
    });

    it('never switches the header back on for an individual screen', () => {
        expect(layout).not.toMatch(/^\s*headerShown:\s*true/m);
    });

    it('has no dead navigator-header styling left behind', () => {
        // headerStyle / headerTintColor / headerTitleStyle / headerTitleAlign are
        // all inert once headerShown is false — leaving them invites someone to
        // "fix" the header instead of the page.
        expect(layout).not.toMatch(/headerStyle:|headerTintColor:|headerTitleStyle:|headerTitleAlign:/);
    });

    it('still gives every screen a `title` (it labels the tab)', () => {
        const titles = [...layout.matchAll(/title:\s*'([^']+)'/g)].map(m => m[1]);
        expect(titles).toEqual([
            'Home',
            'Statistics',
            'Timeline',
            'Insights',
            'Settings',
        ]);
    });
});

describe('styles/global.ts — no competing page-title style', () => {
    it('no longer exports the old header / headerText pair', () => {
        const global = read(path.join(__dirname, '..', 'styles', 'global.ts'));
        // Match the style KEYS at object level, not the word inside a comment.
        expect(global).not.toMatch(/^\s*header:\s*\{/m);
        expect(global).not.toMatch(/^\s*headerText:\s*\{/m);
    });
});
