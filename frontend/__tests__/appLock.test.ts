/**
 * App lock + distress PIN copy (lib/appLock.ts): the promises the Settings
 * texts and the confirmation make.
 */
import {
    APP_LOCK_COPY,
    DISTRESS_TECH_DETAILS,
    PIN_SETUP_COPY,
    distressWarningFor,
} from '@/lib/appLock';
import {
    DEFAULT_DISTRESS_SCOPE,
    DISTRESS_CATEGORIES,
    DISTRESS_CATEGORY_COPY,
    keptSummary,
} from '@/lib/distressScope';

describe('Settings copy', () => {
    const w = distressWarningFor(DEFAULT_DISTRESS_SCOPE);

    it('the app lock is a PIN, no biometrics anywhere', () => {
        expect(APP_LOCK_COPY.lockDescription).toMatch(/PIN/);
        // the screenshot block is announced where the lock is turned on
        expect(APP_LOCK_COPY.lockDescription).toMatch(/screenshots of SoulSync are blocked/);
        const all = JSON.stringify(APP_LOCK_COPY) + DISTRESS_TECH_DETAILS.join(' ') + w;
        expect(all).not.toMatch(/fingerprint|biometric|face/i);
    });

    it('the default confirmation is short, says it cannot be undone, and asks for a backup', () => {
        expect(w).toMatch(/notes, photos and other private details/);
        expect(w).toMatch(/opens normally/);
        expect(w).toMatch(/mood scores stay/);
        expect(w).not.toContain(DISTRESS_CATEGORY_COPY.reminderNames.label);
        expect(w).toMatch(/cannot be undone/);
        expect(w).toMatch(/backup/i);
        // The confirmation stays about what happens; options are explored later.
        expect(w).not.toMatch(/Technical details|options/i);
    });

    it('a custom selection is listed in full, with what is kept', () => {
        const custom = { ...DEFAULT_DISTRESS_SCOPE, health: false };
        const text = distressWarningFor(custom);
        for (const c of DISTRESS_CATEGORIES) {
            if (custom[c]) expect(text).toContain(DISTRESS_CATEGORY_COPY[c].label);
        }
        expect(text).not.toContain(DISTRESS_CATEGORY_COPY.health.label);
        expect(text).toContain(keptSummary(custom));
    });

    it('with every entry selected, the warning says the journal is emptied', () => {
        const all = { ...DEFAULT_DISTRESS_SCOPE, defaultActivityLinks: true, entries: true };
        expect(distressWarningFor(all)).toMatch(/fresh install/);
    });

    it('the default is explained: an empty mood tracker can look suspicious', () => {
        expect(APP_LOCK_COPY.distressWhyDefault).toMatch(/empty .*suspicious/);
        expect(APP_LOCK_COPY.eraseEntriesWarning).toMatch(/suspicious/);
    });

    it('technical details promise what the code does, briefly', () => {
        const d = DISTRESS_TECH_DETAILS.join(' ');
        expect(d).toMatch(/exactly like your app PIN/); // the same unlock (appLockGate)
        expect(d).toMatch(/checked against both, in the same time/); // pinStore.checkPin
        expect(d).toMatch(/deletes itself and this setting resets/); // wipe() + scope reset
        expect(d).toMatch(/Wrong PINs never erase anything/);
        expect(d).toMatch(/overwritten/); // secure_delete + VACUUM
        expect(d).toMatch(/no "forgot PIN"/);
        // what the app cannot reach is said plainly
        expect(d).toMatch(/notification history/);
        expect(d).toMatch(/keyboard has learned/);
        expect(d).toMatch(/access log/);
        expect(APP_LOCK_COPY.distressActiveHint).toMatch(/backup/i);
        // concise: one short sentence or two per point
        for (const line of DISTRESS_TECH_DETAILS) expect(line.length).toBeLessThanOrEqual(160);
        expect(APP_LOCK_COPY.distressWhyDefault.length).toBeLessThanOrEqual(220);
    });

    it('every PIN setup step has a title, and the app PIN warns there is no reset', () => {
        for (const step of Object.values(PIN_SETUP_COPY)) {
            expect(step.title.length).toBeGreaterThan(0);
            expect(step.confirm.length).toBeGreaterThan(0);
        }
        expect(PIN_SETUP_COPY.app.note).toMatch(/no way to reset a forgotten PIN/);
        expect(PIN_SETUP_COPY.change.note).toMatch(/no way to reset a forgotten PIN/);
    });
});
