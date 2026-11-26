/**
 * The app reads the time through ONE clock (`lib/clock.ts`), and that clock is
 * the wall clock unless a test or the QA build freezes it.
 *
 * THE BUG CLASS: time bombs. A pure transform with a hidden
 * `today = localDateString(new Date())` default, or a screen that reads
 * `new Date()` itself, cannot be pinned by a test: the test hardcodes a date,
 * the code reads the real clock, and the pair passes until the calendar moves
 * past the hardcoded date, then fails on every branch at once. The audit of
 * 2026-11 (ops route research, test-suite-audit-2026-11.md) found 11 test
 * files racing the wall clock this way. The future-clock CI leg
 * (.github/workflows/future-clock.yml) finds the bombs that are already
 * there; this scan stops new ones being written.
 *
 * THE RULES (on the TypeScript AST, so comments and strings that merely NAME
 * a call never trip it):
 *   1. wall-clock-read   no zero-argument `new Date()` and no `Date.now()` in
 *                        app source. Read `now()` from `@/lib/clock`, or take
 *                        `now` / `today` as a parameter in a pure transform.
 *   2. qa-setter         `__setFrozenNowForQa` is referenced only by
 *                        lib/clock.ts itself and the QA seed channel
 *                        (lib/qa/). Tests reach it through @/testing/clock.
 *
 * Source-scan verdict: KEEP until a lint rule (no-restricted-syntax on
 * `NewExpression[callee.name=Date][arguments.length=0]`) enforces rule 1.
 * Bug commit: the lane C sweep (PR "test: injected clock + future-clock CI leg").
 */
import * as ts from 'typescript';
import { listSourceFiles, readSource } from '@/testing/sourceScan';
import { now, __setFrozenNowForQa } from '@/lib/clock';
import { freezeNow, unfreezeNow } from '@/testing/clock';
import { localAt } from '@/testing/builders';

// Every app-source folder (testing/ and __tests__ are test code, scripts/ and
// plugins/ are Node build tooling that never ships in the bundle).
const SCAN_ROOTS = ['app', 'components', 'context', 'databases', 'hooks', 'lib', 'styles', 'types'] as const;

/** Files allowed a wall-clock read, and why. Each must still have one (staleness check). */
const WALL_CLOCK_ALLOWED: Record<string, string> = {
    'lib/clock.ts': 'the clock itself',
    'databases/mediaHelpers.ts':
        'buildMediaFilename uses Date.now() as a uniqueness stamp, not as "the time": a frozen QA clock would collide filenames',
};

const QA_SETTER_ALLOWED = (file: string) => file === 'lib/clock.ts' || file.startsWith('lib/qa/');

interface Hit {
    file: string;
    line: number;
    code: string;
}

function scanSource(file: string, src: string): { wallClock: Hit[]; qaSetter: Hit[] } {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const wallClock: Hit[] = [];
    const qaSetter: Hit[] = [];
    const hit = (node: ts.Node): Hit => ({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        code: node.getText(sf),
    });
    const visit = (node: ts.Node) => {
        if (
            ts.isNewExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === 'Date' &&
            (node.arguments === undefined || node.arguments.length === 0)
        ) {
            wallClock.push(hit(node));
        }
        if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) &&
            node.expression.expression.text === 'Date' &&
            node.expression.name.text === 'now'
        ) {
            wallClock.push(hit(node));
        }
        if (ts.isIdentifier(node) && node.text === '__setFrozenNowForQa') {
            qaSetter.push(hit(node));
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return { wallClock, qaSetter };
}

const files = listSourceFiles(SCAN_ROOTS);
const results = files.map((file) => ({ file, ...scanSource(file, readSource(file)) }));

describe('clock injection: source scan', () => {
    it('scans a real tree (guards against a vacuous pass)', () => {
        expect(files.length).toBeGreaterThan(100);
        expect(files).toContain('lib/clock.ts');
        expect(files).toContain('components/visualisations/transforms/streak.ts');
    });

    it('no app source reads the wall clock outside lib/clock.ts (rule 1)', () => {
        const offenders = results
            .filter((r) => !(r.file in WALL_CLOCK_ALLOWED))
            .flatMap((r) => r.wallClock)
            .map((h) => `${h.file}:${h.line}  ${h.code}`);
        // Fix: `import { now } from '@/lib/clock'` and call now(); in a pure
        // transform take `now: Date` / `today: string` as a REQUIRED parameter.
        expect(offenders).toEqual([]);
    });

    it('every wall-clock allowlist entry is still needed', () => {
        const stale = Object.keys(WALL_CLOCK_ALLOWED).filter(
            (file) => (results.find((r) => r.file === file)?.wallClock.length ?? 0) === 0
        );
        expect(stale).toEqual([]);
    });

    it('only lib/clock.ts and lib/qa/ reference __setFrozenNowForQa (rule 2)', () => {
        const offenders = results
            .filter((r) => !QA_SETTER_ALLOWED(r.file))
            .flatMap((r) => r.qaSetter)
            .map((h) => `${h.file}:${h.line}`);
        expect(offenders).toEqual([]);
    });

    it('the scanner sees each banned shape and ignores comments and strings', () => {
        // Positive control: the same scanner over a synthetic file.
        const sample = [
            'const a = new Date();',
            'const b = Date.now();',
            'const c = new Date(0);',
            'const d = new Date;',
            "const e = 'new Date()';",
            '// new Date() and Date.now() in a comment',
            'export const f = __setFrozenNowForQa;',
        ].join('\n');
        const { wallClock, qaSetter } = scanSource('sample.ts', sample);
        expect(wallClock.map((h) => h.code)).toEqual(['new Date()', 'Date.now()', 'new Date']);
        expect(qaSetter.map((h) => h.line)).toEqual([7]);
    });
});

describe('lib/clock now()', () => {
    afterEach(() => {
        jest.useRealTimers();
    });

    it('is the wall clock by default', () => {
        // Fake timers move the system clock, so "the wall clock" is observable exactly.
        jest.useFakeTimers({ now: localAt('2031-02-03', 4, 5) });
        expect(now().getTime()).toBe(localAt('2031-02-03', 4, 5).getTime());
        jest.setSystemTime(localAt('2031-02-04', 6, 7));
        expect(now().getTime()).toBe(localAt('2031-02-04', 6, 7).getTime());
    });

    it('freezes, ignores the system clock while frozen, and unfreezes', () => {
        jest.useFakeTimers({ now: localAt('2031-02-03') });
        const frozen = freezeNow(localAt('2026-06-15', 9));
        jest.setSystemTime(localAt('2040-01-01'));
        expect(now().getTime()).toBe(frozen.getTime());
        unfreezeNow();
        expect(now().getTime()).toBe(localAt('2040-01-01').getTime());
    });

    it('returns a fresh Date each call, so a caller mutating it cannot move the clock', () => {
        const frozen = freezeNow();
        now().setFullYear(1999);
        expect(now().getTime()).toBe(frozen.getTime());
    });

    it('survives jest.resetModules (the freeze lives on globalThis)', () => {
        const frozen = freezeNow();
        jest.resetModules();
        const fresh = jest.requireActual<typeof import('@/lib/clock')>('@/lib/clock');
        expect(fresh.now().getTime()).toBe(frozen.getTime());
    });

    it('rejects an invalid date', () => {
        expect(() => __setFrozenNowForQa(new Date('nope'))).toThrow('invalid date');
    });
});

describe('lib/clock __setFrozenNowForQa guard', () => {
    const saved = { nodeEnv: process.env.NODE_ENV, qa: process.env.EXPO_PUBLIC_QA };
    afterEach(() => {
        process.env.NODE_ENV = saved.nodeEnv;
        if (saved.qa === undefined) delete process.env.EXPO_PUBLIC_QA;
        else process.env.EXPO_PUBLIC_QA = saved.qa;
    });

    it('throws in a user build (neither jest nor the QA build), and the clock stays the wall clock', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.EXPO_PUBLIC_QA;
        expect(() => __setFrozenNowForQa(localAt('2026-06-15'))).toThrow('only available in the QA build');
        expect(() => __setFrozenNowForQa(null)).toThrow('only available in the QA build');
    });

    it('works in the QA build', () => {
        process.env.NODE_ENV = 'production';
        process.env.EXPO_PUBLIC_QA = '1';
        const at = localAt('2026-06-15', 8);
        __setFrozenNowForQa(at);
        expect(now().getTime()).toBe(at.getTime());
        __setFrozenNowForQa(null);
    });
});
