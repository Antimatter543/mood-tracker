import {
  QA_LINK_SCHEME,
  QA_MAX_LINK_LENGTH,
  QA_SCENARIOS,
  QA_SEED_PATH,
  type QaScenario,
} from './index';

/**
 * Pure parser for the QA seed deep link:
 *
 *   myapp://qa/seed?scenario=<name>[&now=<UTC ISO instant>]
 *
 * Hostile-input rules (testing playbook §f):
 *   - the raw length is capped BEFORE any decoding;
 *   - only the two allowlisted keys, each at most once; anything else rejects;
 *   - `scenario` must be one of QA_SCENARIOS; `now` must be a strict UTC instant;
 *   - errors carry a code and the input LENGTH only, never the input itself, so
 *     nothing an attacker sends is echoed into logs or the UI.
 * No regexes on the path, no eval, no SQL, no file paths taken from input.
 */

export interface SeedCommand {
  scenario: QaScenario;
  /** Frozen "now" for the fixture. Absent = the caller uses the real clock. */
  now?: Date;
}

export type SeedLinkError =
  | 'too-long'
  | 'not-seed-link'
  | 'fragment'
  | 'bad-query'
  | 'unknown-key'
  | 'duplicate-key'
  | 'missing-scenario'
  | 'unknown-scenario'
  | 'bad-now';

export type SeedLinkResult =
  | { ok: true; command: SeedCommand }
  | { ok: false; error: SeedLinkError; length: number };

const ALLOWED_KEYS = new Set(['scenario', 'now']);
const SCENARIO_CHARS = /^[A-Za-z0-9]{1,32}$/;
const UTC_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?Z$/;
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** True when `url` addresses the seed path at all (valid or not). */
export function isSeedLink(url: string): boolean {
  if (typeof url !== 'string' || url.length > QA_MAX_LINK_LENGTH) return false;
  return seedLinkRest(url) !== null;
}

/**
 * Strip `myapp://` (or `myapp:///`) and return what follows the seed path:
 * '' (no query), '?...' or '#...'. Null when the link is not the seed path.
 */
function seedLinkRest(url: string): string | null {
  const prefix = `${QA_LINK_SCHEME}://`;
  if (!url.startsWith(prefix)) return null;
  let rest = url.slice(prefix.length);
  if (rest.startsWith('/')) rest = rest.slice(1);
  if (!rest.startsWith(QA_SEED_PATH)) return null;
  rest = rest.slice(QA_SEED_PATH.length);
  if (rest !== '' && rest[0] !== '?' && rest[0] !== '#') return null;
  return rest;
}

function fail(error: SeedLinkError, url: string): SeedLinkResult {
  return { ok: false, error, length: url.length };
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Strict `YYYY-MM-DDTHH:MM:SS(.sss)?Z`, round-trip checked (no Feb 30). */
export function parseUtcInstant(value: string): Date | null {
  const m = UTC_INSTANT.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // Round trip: Date silently rolls 2026-02-30 over to March; reject that.
  const canonical = date.toISOString();
  const expected = m[7] ? value : value.replace('Z', '.000Z');
  return canonical === expected ? date : null;
}

export function parseSeedLink(url: string): SeedLinkResult {
  if (typeof url !== 'string') return { ok: false, error: 'not-seed-link', length: 0 };
  if (url.length > QA_MAX_LINK_LENGTH) return fail('too-long', url);

  const rest = seedLinkRest(url);
  if (rest === null) return fail('not-seed-link', url);
  if (rest.includes('#')) return fail('fragment', url);

  const query = rest.startsWith('?') ? rest.slice(1) : '';
  if (query === '') return fail('missing-scenario', url);

  const values = new Map<string, string>();
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) return fail('bad-query', url);
    const key = decode(pair.slice(0, eq));
    const value = decode(pair.slice(eq + 1));
    if (key === null || value === null) return fail('bad-query', url);
    if (!ALLOWED_KEYS.has(key)) return fail('unknown-key', url);
    if (values.has(key)) return fail('duplicate-key', url);
    values.set(key, value);
  }

  const scenario = values.get('scenario');
  if (scenario === undefined || scenario === '') return fail('missing-scenario', url);
  if (!SCENARIO_CHARS.test(scenario)) return fail('unknown-scenario', url);
  if (!(QA_SCENARIOS as readonly string[]).includes(scenario)) {
    return fail('unknown-scenario', url);
  }

  const command: SeedCommand = { scenario: scenario as QaScenario };
  const nowRaw = values.get('now');
  if (nowRaw !== undefined) {
    const now = parseUtcInstant(nowRaw);
    if (!now) return fail('bad-now', url);
    command.now = now;
  }
  return { ok: true, command };
}
