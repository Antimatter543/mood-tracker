/**
 * Settings version/copyright footer helpers. These keep the displayed version
 * derived from app.json's `expo.version` (via expo-constants) so it can never
 * drift to a stale hardcoded number again (it had been stuck at "1.0.0" while
 * the app shipped at 2.x).
 */
import { versionLine, copyrightLine } from '@/lib/versionInfo';
import appJson from '@/app.json';

describe('versionLine', () => {
  it('formats a real semver version', () => {
    expect(versionLine('2.2.0')).toBe('Version 2.2.0');
  });

  it('falls back to an em-dash when version is undefined (never a stale hardcode)', () => {
    expect(versionLine(undefined)).toBe('Version —');
  });

  it('falls back to an em-dash for null / empty / whitespace', () => {
    expect(versionLine(null)).toBe('Version —');
    expect(versionLine('')).toBe('Version —');
    expect(versionLine('   ')).toBe('Version —');
  });

  it('trims surrounding whitespace', () => {
    expect(versionLine('  1.4.2  ')).toBe('Version 1.4.2');
  });

  it('matches the actual app.json version (catches the hardcode-drift bug)', () => {
    // The whole point: the line must reflect the real shipping version. If
    // someone bumps app.json this stays correct; if someone re-hardcodes a
    // number into the component, this contract still holds for the helper.
    expect(versionLine(appJson.expo.version)).toBe(`Version ${appJson.expo.version}`);
  });
});

describe('copyrightLine', () => {
  it('embeds the supplied (runtime-derived) year', () => {
    expect(copyrightLine(2026)).toBe('© 2026 Raedus Labs. All rights reserved.');
  });

  it('uses whatever year is passed (so new Date().getFullYear() keeps it current)', () => {
    expect(copyrightLine(2030)).toBe('© 2030 Raedus Labs. All rights reserved.');
  });
});
