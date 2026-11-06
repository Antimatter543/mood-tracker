/**
 * Pure lint rules for the Maestro flows in `.maestro/`. The IO (finding files,
 * reading app.json and the source) lives in `__tests__/maestroFlowLint.test.ts`;
 * these functions take strings so the rules themselves can be unit-tested,
 * including against the exact bad inputs they exist to catch.
 *
 * THE BUG CLASS: a flow that is wrong in a way no device run reports clearly.
 *   - Every flow carried `appId: com.raeduslabs.soulsync` while the app ships as
 *     `com.raeduslabs.soulsyncapp`: Maestro launches a package that does not
 *     exist, and only someone reading the log learns why.
 *   - Tabs were tapped by screen percentage (`point: 30%, 89%`), which lands on a
 *     different tab, or on the nav bar, as soon as the screen size, nav mode or
 *     tab-bar height changes. Every tab now has a testID.
 *   - A typo'd `id:` waits out Maestro's timeout and fails as "element not found",
 *     indistinguishable from the real bug the flow guards.
 * This lint fails all three in jest, without a device, in the PR gate.
 */

/** Opt-out marker for a point tap that has no element to target, with a reason. */
export const POINT_OK = /#\s*e2e-lint:\s*point-ok\b\s*\S/;

/** A flow's `appId`, from the config section before the first `---`. */
export function flowAppId(text: string): string | null {
    const sep = text.search(/^---\s*$/m);
    const header = sep === -1 ? text : text.slice(0, sep);
    const m = header.match(/^appId:\s*["']?([^\s"'#]+)["']?\s*(#.*)?$/m);
    return m ? m[1] : null;
}

const isComment = (line: string) => /^\s*#/.test(line);
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

/** 1-based line numbers of `point:` taps that lack a `# e2e-lint: point-ok <reason>` within 3 lines above. */
export function unjustifiedPointTaps(text: string): number[] {
    const lines = text.split('\n');
    const out: number[] = [];
    lines.forEach((line, i) => {
        if (isComment(line) || !/(^|[\s{,-])point:/.test(line)) return;
        const above = lines.slice(Math.max(0, i - 3), i);
        if (!above.some(l => POINT_OK.test(l))) out.push(i + 1);
    });
    return out;
}

/** Every `id:` selector value in a flow, with its 1-based line. */
export function flowIds(text: string): { id: string; line: number }[] {
    const out: { id: string; line: number }[] = [];
    text.split('\n').forEach((line, i) => {
        if (isComment(line)) return;
        const m = line.match(/^\s*(?:-\s*)?id:\s*(.+?)\s*(#.*)?$/);
        if (m) out.push({ id: unquote(m[1]), line: i + 1 });
    });
    return out;
}

/** Every `runFlow` `file:` reference in a flow. */
export function flowFileRefs(text: string): string[] {
    return text
        .split('\n')
        .filter(l => !isComment(l))
        .map(l => l.match(/^\s*(?:-\s*)?file:\s*(.+?)\s*(#.*)?$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map(m => unquote(m[1]));
}

/** Every `openLink:` target in a flow (the one-line form). */
export function flowOpenLinks(text: string): string[] {
    return text
        .split('\n')
        .filter(l => !isComment(l))
        .map(l => l.match(/^\s*(?:-\s*)?openLink:\s*(.+?)\s*(#.*)?$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map(m => unquote(m[1]));
}

/** Every value a flow passes for env var `key` (`env:` blocks of its runFlow calls). */
export function flowEnvValues(text: string, key: string): string[] {
    const re = new RegExp(`^\\s+${key}:\\s*(.+?)\\s*(#.*)?$`);
    return text
        .split('\n')
        .filter(l => !isComment(l))
        .map(l => l.match(re))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map(m => unquote(m[1]));
}

/**
 * The testIDs a source file can render. A literal (`testID="entry-delete"`) is
 * itself; a template (`testID={\`bin-restore-${item.id}\`}`) becomes a sample
 * with each `${...}` replaced by `X` (`bin-restore-X`), so a flow's regex id
 * (`bin-restore-.*`) can be checked against it.
 */
export function sourceTestIds(src: string): string[] {
    const out: string[] = [];
    const re = /\btestID(?:=\{?|:)\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
    for (let m = re.exec(src); m; m = re.exec(src)) {
        out.push(m[2].replace(/\$\{[^}]*\}/g, 'X'));
    }
    return out;
}

const REGEX_META = /[.*+?^$()[\]{}|\\]/;
const FLOW_VAR = /\$\{[^}]*\}/g;

/** A template sample (`activity-grid-X`) as the regex of what it can render. */
function sampleToRegex(sample: string): RegExp {
    const literal = sample.split('X').map(s => s.replace(/[.*+?^$()[\]{}|\\]/g, '\\$&'));
    return new RegExp(`^${literal.join('.+')}$`);
}

/**
 * Whether a flow's `id:` can match something the app renders. Maestro treats
 * the id as a full-match regex: a plain id must be a known testID, or one value of
 * a template (`activity-grid-1` for `activity-grid-X`); a regex id must fully match
 * at least one known id or template sample. A flow variable (`setting-option-${T}`)
 * stands for a template hole, the same `X` sourceTestIds writes.
 *
 * A sample that is ALL holes (`${prefix}${name}`) says nothing about what it renders,
 * so it never vouches for a plain id: it would make this check pass anything.
 */
export function idIsKnown(rawId: string, known: ReadonlySet<string>): boolean {
    const id = rawId.replace(FLOW_VAR, 'X');
    if (!REGEX_META.test(id)) {
        if (known.has(id)) return true;
        return [...known].some(k => /[^X]/.test(k) && k.includes('X') && sampleToRegex(k).test(id));
    }
    let re: RegExp;
    try {
        re = new RegExp(`^(?:${id})$`);
    } catch {
        return false;
    }
    return [...known].some(k => re.test(k));
}

/**
 * Every screenshot a flow takes, in order: the name and the 1-based line of the
 * `takeScreenshot` step. Both forms: `- takeScreenshot: name` and
 * `- takeScreenshot:` + an indented `path: name`.
 */
export function flowScreenshots(text: string): { name: string; line: number }[] {
    const lines = text.split('\n');
    const out: { name: string; line: number }[] = [];
    lines.forEach((line, i) => {
        if (isComment(line)) return;
        const m = line.match(/^\s*-\s*takeScreenshot:\s*(.*?)\s*(#.*)?$/);
        if (!m) return;
        if (m[1]) {
            out.push({ name: unquote(m[1]), line: i + 1 });
            return;
        }
        const indent = line.search(/\S/);
        for (let j = i + 1; j < lines.length && (lines[j].search(/\S/) > indent || !lines[j].trim()); j++) {
            const path = lines[j].match(/^\s*path:\s*(.+?)\s*(#.*)?$/);
            if (path) {
                out.push({ name: unquote(path[1]), line: i + 1 });
                return;
            }
        }
        out.push({ name: '', line: i + 1 });
    });
    return out;
}

/**
 * 1-based lines of `takeScreenshot` steps whose previous step is not
 * `waitForAnimationToEnd`: a shot taken mid-animation is a flaky golden, and the
 * diff would blame the app for it.
 */
export function shotsWithoutSettle(text: string): number[] {
    const lines = text.split('\n');
    return flowScreenshots(text)
        .filter(({ line }) => {
            const before = lines.slice(0, line - 1).filter(l => l.trim() && !isComment(l));
            return !/^\s*-\s*waitForAnimationToEnd\b/.test(before[before.length - 1] ?? '');
        })
        .map(s => s.line);
}

/** A `NAME=( ... )` list in a bash script (one item per line, `#` comments allowed). */
export function bashList(script: string, name: string): string[] {
    const m = script.match(new RegExp(`^${name}=\\(\\s*\\n([\\s\\S]*?)^\\)`, 'm'));
    if (!m) return [];
    return m[1]
        .split('\n')
        .map(l => l.replace(/#.*/, '').trim())
        .filter(Boolean);
}
