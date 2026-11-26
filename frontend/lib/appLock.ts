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
        'Ask for a PIN every time SoulSync opens or comes back from the background.',
    changePin: 'Change PIN',
    distressDescription:
        'A second PIN for when someone makes you unlock SoulSync. It opens the app like your normal PIN, ' +
        'but first quietly removes your notes, photos and other private details. Your days and mood scores ' +
        'stay, so the journal still looks normal.',
    distressWarningTitle: 'Turn on the distress PIN?',
    distressWhyDefault:
        'An empty or freshly wiped mood tracker can itself look suspicious. So by default SoulSync keeps every ' +
        'logged day with its date, mood score and default activities, and removes only what could give you away. ' +
        'The journal then still looks like it has been used normally. Only change this if an empty app is safer for you.',
    distressCustomScope: 'Custom selection of what gets erased (see Technical details).',
    eraseEntriesTitle: 'Erase all entries too?',
    eraseEntriesWarning:
        'With this on, the distress PIN also deletes every entry and mood score. SoulSync then looks like a ' +
        'fresh install with an empty journal. Keep in mind that an empty mood tracker can itself look ' +
        'suspicious, which is why this is off by default. Only a backup kept outside this phone can bring it back.',
    distressActiveHint:
        'Distress PIN is set. Keep a recent backup outside this phone: it is the only way to get your notes back after it is used.',
    noScreenLockTitle: 'No screen lock',
    noScreenLock:
        'Set up a screen lock (PIN, pattern or password) in your phone settings first. It is how you get back in if you forget your SoulSync PIN.',
    forgotTitle: 'Forgot your PIN?',
    forgotMessage:
        "Confirm with your phone's screen lock. The app lock then turns off, and you can set a new PIN in Settings.",
    lockTurnedOff: 'App lock is off. Set a new PIN in Settings.',
} as const;

/** Titles for the PIN setup dialog. */
export const PIN_SETUP_COPY = {
    app: { title: 'Choose an app PIN', confirm: 'Enter the PIN again' },
    change: { title: 'Choose a new app PIN', confirm: 'Enter the new PIN again' },
    distress: { title: 'Choose a distress PIN', confirm: 'Enter the distress PIN again' },
} as const;

/**
 * "Technical details" for the distress PIN (Settings dialog). Kept here so the
 * tests can pin every promise it makes against what the code does.
 */
export const DISTRESS_TECH_DETAILS: readonly string[] = [
    'The distress PIN unlocks SoulSync exactly like your app PIN: same screen, same wait, the app opens. ' +
        'Before it shows anything, it erases what is selected below.',
    'Nothing on the lock screen shows whether a distress PIN is set. Every PIN you type is checked against ' +
        'both PINs, so it takes the same time either way.',
    'After it is used, the distress PIN is deleted and this option turns itself off. Settings then look like ' +
        'an app lock without a distress PIN.',
    'Wrong PINs never erase anything. After 5 in a row SoulSync makes you wait, the same with or without a distress PIN.',
    'Erased data is overwritten in the database file, not just marked as deleted.',
    "Out of reach for the app: backups you saved elsewhere (Drive, email), Android's own device backup, " +
        'and data stored in Health Connect itself.',
    "If you forget your PIN, \"Forgot PIN?\" asks for your phone's screen lock and turns the app lock off. " +
        'With a distress PIN set, it erases the same as the distress PIN first, because anyone who knows your ' +
        'phone PIN could use this way in.',
];

/**
 * The confirmation shown before setting a distress PIN. With the recommended
 * selection it is short; a custom selection is listed in full, because that is
 * what will happen.
 */
export function distressWarningFor(scope: DistressScope): string {
    const trigger = 'When you unlock SoulSync with the distress PIN, SoulSync silently and permanently ';
    const care =
        'It cannot be undone. Make a backup first and keep it somewhere other than this phone. ' +
        'Forgetting your app PIN has the same effect, so pick PINs you will remember.';
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
