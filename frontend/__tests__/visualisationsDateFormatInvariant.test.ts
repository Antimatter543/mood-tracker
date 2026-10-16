/**
 * CLASS-LEVEL INVARIANT (same family as writeTransactionInvariant.test.ts).
 *
 * THE BUG CLASS. v2.14.0 added a Date format setting (System / MM-DD / DD-MM /
 * ISO) and made lib/dateFormat.ts the ONE place a display date gets spelled. It
 * was then fixed site by site, and each pass missed siblings: a chart that kept
 * its own month table, its own `toLocaleDateString('en-US', ...)`, or its own
 * hand-written "1 Jul" string kept showing the old format after the user picked
 * another one. PR #14 fixed the Stats period header; this guard exists because
 * four more siblings (Month over Month, the heatmap, the weekly-mood axis, the
 * overlay chart) were still open afterwards. (frontend/tasks/lessons.md,
 * 2026-09-26: "find sites by what they PRODUCE, not what they call".)
 *
 * THE RULE. Nothing under components/visualisations spells a date on its own.
 * Three static rules, enforced on the TypeScript AST (comments and strings
 * that merely MENTION a banned call are not code, so they never trip it):
 *
 *   1. locale-date-call   no `.toLocaleDateString(...)`, no `Intl.DateTimeFormat`,
 *                         and no `.toLocaleString`/`.toLocaleTimeString` handed
 *                         date-field options (year/month/day/weekday/dateStyle).
 *                         Those format with the device's rules and ignore the
 *                         setting. (`toLocaleTimeString` with hour/minute only,
 *                         and number `toLocaleString`, are not dates: fine.)
 *   2. month-name-table   no hand-written English month table (an array of 3+
 *                         month names, or one string holding 3+ of them).
 *   3. hardcoded-pref     `formatDate` / `formatMonth` imported from
 *                         lib/dateFormat must be given a `pref` that comes from
 *                         somewhere, never a string literal: `formatDate(d,
 *                         'system', ...)` silently opts the site out of the
 *                         setting. (A site that must keep hardcoded English
 *                         under `system` uses `pinSystemTo(pref, legacy)`, a
 *                         call, so it passes.)
 *
 * SCOPE. components/visualisations/** only. Other surfaces were swept in
 * v2.14.0. A route that wants the same guard can widen SCAN_ROOTS and add its
 * own allowlist entries; each entry must say why and is checked for staleness.
 *
 * KNOWN LIMIT. This catches the shapes the bug has actually taken. A hand-rolled
 * numeric string (`${m}/${d}`) is invisible to it; the per-site tests in
 * dateFormatSiblingSites.test.tsx (and each transform's own file) are what pin
 * the OUTPUT of a site. This test pins that no site opts out of the authority.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative, sep } from 'path';
import * as ts from 'typescript';

const root = join(__dirname, '..');
const SCAN_ROOTS = ['components/visualisations'] as const;

type Rule = 'locale-date-call' | 'month-name-table' | 'hardcoded-pref';
interface Violation {
  file: string;
  line: number;
  rule: Rule;
  code: string;
}
interface ScanResult {
  violations: Violation[];
  /** formatDate/formatMonth calls resolved to the lib/dateFormat import. */
  authorityCalls: number;
}

const MONTH_WORDS: ReadonlySet<string> = new Set([
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);
/** 2 month names in a list is a pair of labels; 3+ is a month table. */
const MIN_MONTHS_FOR_A_TABLE = 3;
const DATE_FIELD_OPTIONS: ReadonlySet<string> = new Set([
  'year', 'month', 'day', 'weekday', 'era', 'dateStyle',
]);
const AUTHORITY_FUNCTIONS: ReadonlySet<string> = new Set(['formatDate', 'formatMonth']);
const AUTHORITY_MODULE = /(^|\/)lib\/dateFormat$/;

/** Strips `as X` / `(x)` / `x!` / `<X>x` / `x satisfies X` down to the value. */
function unwrap(expr: ts.Expression): ts.Expression {
  let e = expr;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e) ||
    ts.isSatisfiesExpression(e)
  ) {
    e = e.expression;
  }
  return e;
}

const monthWordsIn = (text: string): Set<string> =>
  new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => MONTH_WORDS.has(w)));

/** Does an options object literal name a date field (`{ month: 'short' }`)? */
function hasDateFieldOption(arg: ts.Expression): boolean {
  if (!ts.isObjectLiteralExpression(arg)) return false;
  return arg.properties.some((p) => {
    const name = p.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name))) return false;
    return DATE_FIELD_OPTIONS.has(name.text);
  });
}

/** Scans one source text. Pure: the file name only picks TS vs TSX parsing. */
function scanSource(file: string, source: string): ScanResult {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  // Local names bound to formatDate / formatMonth FROM lib/dateFormat. A call to
  // some other `formatDate` (e.g. the pref-bound closure `useDateFormat().format`
  // destructured under that name) is a different function and is not rule 3's
  // business.
  const authorityNames = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!AUTHORITY_MODULE.test(stmt.moduleSpecifier.text)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      if (AUTHORITY_FUNCTIONS.has((el.propertyName ?? el.name).text)) authorityNames.add(el.name.text);
    }
  }

  const violations: Violation[] = [];
  let authorityCalls = 0;
  // Reports the whole CALL when the offender is the callee, so the message
  // reads `d.toLocaleDateString('en-US', ...)`, not just `d.toLocaleDateString`.
  const report = (node: ts.Node, rule: Rule) => {
    const shown =
      node.parent && ts.isCallExpression(node.parent) && node.parent.expression === node
        ? node.parent
        : node;
    violations.push({
      file,
      line: sf.getLineAndCharacterOfPosition(shown.getStart(sf)).line + 1,
      rule,
      code: shown.getText(sf).replace(/\s+/g, ' ').slice(0, 80),
    });
  };

  const visit = (node: ts.Node): void => {
    // Rule 1: the device's own date formatting.
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === 'toLocaleDateString') report(node, 'locale-date-call');
      if (
        node.name.text === 'DateTimeFormat' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Intl'
      ) {
        report(node, 'locale-date-call');
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'toLocaleDateString'
    ) {
      report(node, 'locale-date-call');
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'toLocaleString' ||
        node.expression.name.text === 'toLocaleTimeString') &&
      node.arguments.some(hasDateFieldOption)
    ) {
      report(node, 'locale-date-call');
    }

    // Rule 2: a hand-written English month table.
    if (ts.isArrayLiteralExpression(node)) {
      const names = new Set<string>();
      for (const el of node.elements) {
        if (ts.isStringLiteralLike(el) && MONTH_WORDS.has(el.text.toLowerCase())) {
          names.add(el.text.toLowerCase());
        }
      }
      if (names.size >= MIN_MONTHS_FOR_A_TABLE) report(node, 'month-name-table');
    }
    if (ts.isStringLiteralLike(node) && monthWordsIn(node.text).size >= MIN_MONTHS_FOR_A_TABLE) {
      report(node, 'month-name-table');
    }

    // Rule 3: a literal preference handed to the authority.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      authorityNames.has(node.expression.text)
    ) {
      authorityCalls += 1;
      if (node.arguments.length >= 2 && ts.isStringLiteralLike(unwrap(node.arguments[1]))) {
        report(node, 'hardcoded-pref');
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);

  return { violations, authorityCalls };
}

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== 'node_modules') out.push(...sourceFilesUnder(full));
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const posix = (abs: string): string => relative(root, abs).split(sep).join('/');

/**
 * Documented exceptions. Each must say WHY and is checked for staleness below,
 * so the list can only shrink or be re-justified, never silently rot.
 */
const ALLOWED: ReadonlyArray<{ file: string; rule: Rule; why: string }> = [
  {
    file: 'components/visualisations/transforms/periodWindow.ts',
    rule: 'month-name-table',
    why:
      'MONTH_NAMES duplicates lib/dateFormat MONTHS_SHORT for the custom-range header ' +
      '(PR #14). It is only reached through the pref-aware label builder, and ' +
      'customRangeWindow.test.ts pins it against formatDate for all 12 months.',
  },
];

const scanned = SCAN_ROOTS.flatMap((dir) => sourceFilesUnder(join(root, dir))).map((abs) => ({
  file: posix(abs),
  ...scanSource(posix(abs), readFileSync(abs, 'utf8')),
}));
const allViolations = scanned.flatMap((s) => s.violations);
const isAllowed = (v: Violation) => ALLOWED.some((a) => a.file === v.file && a.rule === v.rule);
const describeViolation = (v: Violation) => `${v.file}:${v.line} [${v.rule}] ${v.code}`;

describe('visualisations never spell a date outside lib/dateFormat', () => {
  it('actually scanned the tree (a green run is not a vacuous pass)', () => {
    const files = scanned.map((s) => s.file);
    // The four sites this guard was written for, plus the PR #14 one.
    for (const expected of [
      'components/visualisations/MonthOverMonthCard.tsx',
      'components/visualisations/CustomHeatMap.tsx',
      'components/visualisations/MoodMetricOverlayCard.tsx',
      'components/visualisations/transforms/heatmap.ts',
      'components/visualisations/transforms/weeklyMood.ts',
      'components/visualisations/transforms/monthOverMonth.ts',
      'components/visualisations/transforms/moodMetricOverlay.ts',
      'components/visualisations/transforms/periodWindow.ts',
      'components/visualisations/chartUtils.ts',
    ]) {
      expect(files).toContain(expected);
    }
    // Rule 3 resolves the import binding on REAL files (not just on snippets).
    expect(scanned.reduce((n, s) => n + s.authorityCalls, 0)).toBeGreaterThanOrEqual(8);
  });

  it('has no locale-date call, English month table, or literal preference outside the allowlist', () => {
    expect(allViolations.filter((v) => !isAllowed(v)).map(describeViolation)).toEqual([]);
  });

  it.each(ALLOWED.map((a) => [`${a.file} [${a.rule}]`, a] as const))(
    'allowlist entry %s is still needed (no stale exemption)',
    (_label, entry) => {
      expect(allViolations.some((v) => v.file === entry.file && v.rule === entry.rule)).toBe(true);
      expect(entry.why.length).toBeGreaterThan(20);
    },
  );
});

/**
 * The scanner itself, on inline snippets: a guard that cannot fail proves
 * nothing, and a guard that fails on good code gets deleted.
 */
describe('the scanner has teeth (and no false alarms)', () => {
  const AUTH = "import { formatDate, formatMonth, pinSystemTo } from '@/lib/dateFormat';\n";
  const rulesIn = (source: string, file = 'snippet.ts') =>
    scanSource(file, source).violations.map((v) => v.rule);

  it.each<[string, string, Rule]>([
    ['toLocaleDateString', "const l = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });", 'locale-date-call'],
    ['toLocaleDateString, no args', 'const l = (d: Date) => d.toLocaleDateString();', 'locale-date-call'],
    ['Intl.DateTimeFormat', "const f = new Intl.DateTimeFormat('en-US', { month: 'short' });", 'locale-date-call'],
    ['bracket access', "const l = (d: Date) => d['toLocaleDateString']();", 'locale-date-call'],
    ['toLocaleString with date fields', "const l = (d: Date) => d.toLocaleString(undefined, { month: 'long', day: 'numeric' });", 'locale-date-call'],
    ['toLocaleTimeString with date fields', "const l = (d: Date) => d.toLocaleTimeString([], { weekday: 'short', hour: 'numeric' });", 'locale-date-call'],
    ['short month table', "const M = ['Jan', 'Feb', 'Mar', 'Apr'];", 'month-name-table'],
    ['long month table (3 names)', "const M = ['January', 'February', 'March'];", 'month-name-table'],
    ['lower-case month table', "const M = ['jan', 'feb', 'mar'];", 'month-name-table'],
    ['month names in one string', "const M = 'Jan Feb Mar Apr May Jun'.split(' ');", 'month-name-table'],
    ['literal pref', `${AUTH}const l = (d: Date) => formatDate(d, 'system', 'medium');`, 'hardcoded-pref'],
    ['literal pref via `as`', `${AUTH}const l = (d: Date) => formatDate(d, 'mdy' as const, 'medium');`, 'hardcoded-pref'],
    ['literal pref in parens', `${AUTH}const l = (d: Date) => formatDate(d, ('ymd'), 'numeric');`, 'hardcoded-pref'],
    ['literal pref via formatMonth', `${AUTH}const l = (d: Date) => formatMonth(d, 'dmy', 'long');`, 'hardcoded-pref'],
    [
      'literal pref through an import alias',
      "import { formatMonth as fm } from '../../../lib/dateFormat';\nconst l = (d: Date) => fm(d, 'mdy', 'long');",
      'hardcoded-pref',
    ],
  ])('flags: %s', (_name, source, rule) => {
    expect(rulesIn(source)).toEqual([rule]);
  });

  it.each<[string, string]>([
    ['a pref that comes from somewhere', `${AUTH}const l = (d: Date, pref: string) => formatDate(d, pref as never, 'medium');`],
    ['pinSystemTo (a call, not a literal)', `${AUTH}const l = (d: Date, p: never) => formatDate(d, pinSystemTo(p, 'dmy'), 'mediumNoYear');`],
    ['the pref-bound closure from useDateFormat', "const { format: formatDate } = useDateFormat();\nconst l = (d: Date) => formatDate(d, 'numeric');"],
    ['a formatDate from another module', "import { formatDate } from './elsewhere';\nconst l = (d: Date) => formatDate(d, 'system', 'x');"],
    ['time-only formatting', "const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });"],
    ['number formatting', 'const n = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });'],
    ['a weekday table', "const W = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];"],
    ['two month names (a pair of labels, not a table)', "const P = ['Jan', 'Feb'];"],
    ['the words in comments only', "// d.toLocaleDateString('en-US')\n/** Jan Feb Mar Apr May Jun */\nconst x = 1;"],
    ['the words in a type', "type Style = 'month' | 'day'; const o = { month: 'short' };"],
  ])('allows: %s', (_name, source) => {
    expect(rulesIn(source)).toEqual([]);
  });

  it('parses TSX (JSX expressions are scanned too)', () => {
    const tsx = "const C = ({ d }: { d: Date }) => <Text>{d.toLocaleDateString('en-US')}</Text>;";
    expect(rulesIn(tsx, 'snippet.tsx')).toEqual(['locale-date-call']);
  });

  it('reports the line of the offender', () => {
    const [v] = scanSource('snippet.ts', "const a = 1;\n\nconst l = (d: Date) => d.toLocaleDateString();").violations;
    expect(v.line).toBe(3);
  });
});
