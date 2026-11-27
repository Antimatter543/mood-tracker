/**
 * App lock + distress PIN: Settings copy and the confirmation text, kept here
 * so the tests can pin every promise they make against what the code does.
 *
 * The model (lib/pinLock.ts, lib/pinStore.ts, context/AppLock.tsx):
 *   - the app lock is a PIN, asked on every open and every return from the
 *     background,
 *   - the distress PIN is a second PIN that unlocks exactly like the real one
 *     and quietly runs the distress wipe first (databases/distressWipe.ts).
 * Nothing on the lock screen differs with or without a distress PIN.
 */
import { DistressScope, erasedCategoryLabels, isDefaultScope, keptSummary } from '@/lib/distressScope';

export const APP_LOCK_COPY = {
    lockDescription:
        'Ask for a PIN every time SoulSync opens or comes back from the background. While it is on, ' +
        'screenshots of SoulSync are blocked and the app switcher shows no preview.',
    changePin: 'Change app PIN',
    changeDistressPin: 'Change distress PIN',
    distressDescription:
        'A second PIN for when someone makes you unlock SoulSync. It opens the app like your normal PIN, ' +
        'but first quietly removes your notes, photos and other private details. Your days and mood scores ' +
        'stay, so the journal still looks normal.',
    distressWarningTitle: 'Turn on the distress PIN?',
    distressWhyDefault:
        'An empty journal can look suspicious. So by default every day keeps its date, mood and default ' +
        'activities, and only what could give you away is erased. Change this only if an empty app is safer for you.',
    distressCustomScope: 'Custom selection of what gets erased (see Technical details).',
    eraseEntriesTitle: 'Erase all entries too?',
    eraseEntriesWarning:
        'With this on, the distress PIN also deletes every entry and mood score. SoulSync then looks like a ' +
        'fresh install with an empty journal. Keep in mind that an empty mood tracker can itself look ' +
        'suspicious, which is why this is off by default. Only a backup kept outside this phone can bring it back.',
    distressActiveHint:
        'Distress PIN is set. Keep a recent backup outside this phone: it is the only way to get your notes back after it is used.',
} as const;

/** Titles for the PIN setup dialog. */
export const PIN_SETUP_COPY = {
    app: {
        title: 'Choose an app PIN',
        confirm: 'Enter the PIN again',
        note: 'There is no way to reset a forgotten PIN. You would have to clear SoulSync\'s app data and restore a backup.',
    },
    change: {
        title: 'Choose a new app PIN',
        confirm: 'Enter the new PIN again',
        note: 'There is no way to reset a forgotten PIN. You would have to clear SoulSync\'s app data and restore a backup.',
    },
    distress: {
        title: 'Choose a distress PIN',
        confirm: 'Enter the distress PIN again',
        note: 'Must be different from your app PIN.',
    },
    changeDistress: {
        title: 'Choose a new distress PIN',
        confirm: 'Enter the new distress PIN again',
        note: 'Must be different from your app PIN.',
    },
} as const;

/**
 * "Technical details" for the distress PIN (Settings dialog). Kept here so the
 * tests can pin every promise it makes against what the code does.
 */
export const DISTRESS_TECH_DETAILS: readonly string[] = [
    'It opens SoulSync exactly like your app PIN, after erasing what is selected below.',
    'Every PIN is checked against both, in the same time, so the lock screen never shows a distress PIN is set.',
    'Once used, it deletes itself and this setting resets, as if it had never been set.',
    'Wrong PINs never erase anything. After 5 in a row you have to wait.',
    'Erased data is overwritten, not just marked deleted. Photos are removed in the background after unlocking.',
    "Out of reach: backups kept elsewhere, Android's backup and notification history, Health Connect's " +
        'own data and access log, and what your keyboard has learned.',
    'There is no "forgot PIN": a forgotten PIN means clearing app data and restoring a backup.',
];

/**
 * The confirmation shown before setting a distress PIN. With the recommended
 * selection it is short; a custom selection is listed in full, because that is
 * what will happen.
 */
export function distressWarningFor(scope: DistressScope): string {
    const trigger = 'When you unlock SoulSync with the distress PIN, SoulSync silently and permanently ';
    const care =
        'It cannot be undone. Make a backup first and keep it somewhere other than this phone.';
    if (isDefaultScope(scope)) {
        return (
            trigger +
            'removes your notes, photos and other private details, then opens normally. Your days and mood ' +
            'scores stay, so the journal still looks normal.\n\n' +
            care
        );
    }
    const labels = erasedCategoryLabels(scope);
    const list = labels.length
        ? labels.map(l => `• ${l}`).join('\n')
        : '• nothing (every category is switched off)';
    return trigger + 'erases:\n\n' + list + '\n\n' + keptSummary(scope) + '\n\n' + care;
}
