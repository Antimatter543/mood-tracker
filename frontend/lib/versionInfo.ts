// versionInfo.ts
//
// Pure helpers for the Settings "Version" / copyright footer. Kept out of the
// component so they can be unit-tested without rendering, and so the displayed
// version can NEVER go stale: it's derived at runtime from app.json's
// `expo.version` (via expo-constants), not hardcoded.

/**
 * Build the "Version X.Y.Z" line. `version` is `Constants.expoConfig?.version`
 * (the single source of truth — `frontend/app.json` `expo.version`), which can
 * be `undefined` in some runtimes (e.g. bare web). Fall back to an em-dash so we
 * never render a hardcoded, drifting number.
 */
export function versionLine(version: string | undefined | null): string {
  const v = typeof version === 'string' && version.trim().length > 0
    ? version.trim()
    : '—';
  return `Version ${v}`;
}

/**
 * Build the copyright line with a runtime-derived year so it never goes stale.
 * Pass `new Date().getFullYear()` at the call site (keeps this pure/testable).
 */
export function copyrightLine(year: number): string {
  return `© ${year} Raedus Labs. All rights reserved.`;
}
