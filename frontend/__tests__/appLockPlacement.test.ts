/** @jest-environment node */
/**
 * Where the app lock sits in the tree (app/(tabs)/_layout.tsx), and that the
 * distress wipe keeps to the DB write contract. Source scans: a wrong placement
 * renders fine in jest and only fails on a phone.
 *
 *   - INSIDE SettingsProvider + SQLiteProvider: the gate reads both.
 *   - AROUND OverlayProvider: the lock screen must paint above every overlay
 *     (an entry form left open when the app was minimised), and a distress
 *     wipe's remount must take the open overlays with it.
 */
import { code } from '@/testing/sourceScan';

describe('app lock placement', () => {
    const layout = code('app/(tabs)/_layout.tsx');
    const at = (s: string) => {
        const i = layout.indexOf(s);
        expect(i).toBeGreaterThanOrEqual(0);
        return i;
    };

    it('wraps the OverlayProvider, inside the Settings and SQLite providers', () => {
        expect(at('<SQLiteProvider')).toBeLessThan(at('<SettingsProvider>'));
        expect(at('<SettingsProvider>')).toBeLessThan(at('<AppLockProvider>'));
        expect(at('<AppLockProvider>')).toBeLessThan(at('<OverlayProvider>'));
        expect(at('</OverlayProvider>')).toBeLessThan(at('</AppLockProvider>'));
        expect(at('</AppLockProvider>')).toBeLessThan(at('</SettingsProvider>'));
    });

    it('the Settings screen renders the Privacy & security card', () => {
        expect(code('app/(tabs)/settings.tsx')).toMatch(/<AppLockSection \/>/);
    });
});

describe('distress wipe write contract (databases/CLAUDE.md)', () => {
    const src = code('databases/distressWipe.ts');

    it('never uses expo transactions directly', () => {
        expect(src).not.toMatch(/withExclusiveTransactionAsync|withTransactionAsync/);
    });

    it('writes only inside withWriteTransaction (statements on txn)', () => {
        const body = src.slice(src.indexOf('withWriteTransaction(async (txn)'));
        expect(body.length).toBeGreaterThan(0);
        // The pre-read is the only statement on the read connection.
        const readConnStatements = src.match(/\bdb\.(runAsync|execAsync)\(/g) ?? [];
        expect(readConnStatements).toHaveLength(0);
    });
});
