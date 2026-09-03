/**
 * Render/interaction tests for RemindersSection — the Reminders card that
 * replaced the old single daily-reminder switch with a list (see
 * components/RemindersSection.tsx + the model in lib/reminders.ts).
 *
 * What this locks:
 *  - Empty/list/corrupt render states, and display ordering (earliest time
 *    first, independent of storage order — sortRemindersByTime is the model's
 *    job, this just proves the component actually calls it).
 *  - The component's ONLY output is what it hands `updateSetting('reminders',
 *    <json>)` — every persistence assertion decodes that json with
 *    `parseReminders` from lib/reminders and asserts on the resulting objects,
 *    never on the raw string.
 *  - Permission gating: toggling ON and saving a brand-new reminder both ask
 *    for permission (and behave correctly whether it's granted or denied);
 *    toggling OFF and editing an existing reminder never ask.
 *  - The MAX_REMINDERS cap disables Add without touching storage.
 *  - The editor renders through the REAL in-tree `OverlayModal` /
 *    `OverlayProvider` (never a mocked-away modal) — that it actually mounts
 *    through the app's own overlay host is part of the contract being locked.
 *
 * THE GAP THIS SUITE ONCE HAD (device QA, 2026-09-03 — see the round-trip
 * describe at the bottom): `mockUpdateSetting` is a black hole and
 * `mockSettings` is static, so nothing here ever fed the component's OWN
 * persisted output back into it. Every test asserted either "given this stored
 * list, the rows look right" or "given these gestures, this json is written" —
 * never "save, then look at the list". A reminder saved with no name therefore
 * rendered as the generic "Reminder" fallback on the device while the suite was
 * fully green. `renderLiveSection()` closes that: updateSetting writes back into
 * the settings value and re-renders, exactly like SettingsProvider does.
 *
 * Second half of that gap: `fireEvent.changeText` types into a field whether or
 * not it could ever hold focus, so a dialog whose input never focuses still
 * tests as typeable. Hence the explicit autoFocus/placeholder assertions — the
 * editor's field must be typeable the moment it opens, and its placeholder must
 * never read as an entered value (a bare "Morning check-in" placeholder was
 * read as saved data by on-device QA).
 *
 * Gotcha this repo already paid for once (tasks/lessons.md, 2026-08-29):
 * @testing-library/react-native v14 is async-by-default — `render()` and every
 * `fireEvent.*()` return Promises. An un-awaited `fireEvent.press()` fails
 * SILENTLY (no error, no state change) and a correct component reads as
 * broken. Every render()/fireEvent() call below is awaited. Conversely, a
 * `disabled` Pressable correctly no-ops on `fireEvent.press` — the
 * MAX_REMINDERS cap test below exploits exactly that as a valid bounds check.
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { OverlayProvider } from '@/context/OverlayHost';
import {
    MAX_REMINDERS,
    Reminder,
    parseReminders,
    serializeReminders,
} from '@/lib/reminders';
import type { Settings } from '@/databases/settings';

// ── @/context/SettingsContext: the component's ONLY data source ────────────
// Mocking the whole module also drives the REAL `useThemeColors` (styles/global
// reads settings.theme/theme_mode through this same module), so we get real
// theme resolution for free instead of a shallow color stub — and it means we
// never need to boot the real SQLite-backed SettingsProvider.
const mockSettings = jest.fn<Settings, []>();
const mockUpdateSetting = jest.fn(async (_key: string, _value: string) => {});
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettings(), updateSetting: mockUpdateSetting }),
}));

// ── @/lib/notifications: permission gate, driven per test ──────────────────
const mockRequestPermission = jest.fn(async () => true);
jest.mock('@/lib/notifications', () => ({
    requestNotificationPermission: () => mockRequestPermission(),
}));

// ── @react-native-community/datetimepicker: never actually opened in these
// tests (no test drives the native time picker), but the module must not
// throw just from being imported/rendered when showTimePicker flips true.
jest.mock('@react-native-community/datetimepicker', () => ({
    __esModule: true,
    default: 'DateTimePicker',
}));

// ── OverlayModal's dependencies that don't work under jest ──────────────────
// Mirrors the proven pattern in __tests__/overlayKeyboardSafeArea.test.tsx:
// reanimated's worklet runtime isn't available under jest, and
// useSafeAreaInsets needs a provider we don't have here.
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/hooks/useKeyboardHeight', () => ({
    useKeyboardHeight: () => 0,
}));
jest.mock('react-native-reanimated', () => {
    const ReactLocal = require('react');
    const { View } = require('react-native');
    const entering = { duration: () => entering };
    return {
        __esModule: true,
        default: {
            View: (props: Record<string, unknown>) => ReactLocal.createElement(View, props),
        },
        FadeIn: entering,
    };
});
// @expo/vector-icons renders fine under jest-expo without a mock (see
// __tests__/activityReorder.test.tsx) — deliberately not mocked here.

import { RemindersSection, formatTimeForDisplay } from '@/components/RemindersSection';

const baseSettings: Settings = {
    fab_position: 'right',
    theme_mode: 'dark',
    theme: 'dark',
    mood_precision: 'low',
    show_mood_benchmarks: true,
    activity_carryover: false,
    reminders: '[]',
};

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
    return { id: 'reminder-1', label: 'Morning check-in', time: '08:00', enabled: true, ...overrides };
}

function renderSection() {
    return render(
        <OverlayProvider>
            <RemindersSection />
        </OverlayProvider>
    );
}

/**
 * Render with a LIVE settings value: `updateSetting` writes the new json back
 * into the settings object and re-renders the tree, exactly like the real
 * SettingsProvider does (it `setSettings`es on every write, which is what makes
 * an edit show up in the list immediately).
 *
 * `renderSection` above deliberately keeps a STATIC settings value — that is the
 * right shape for asserting "given this stored list, X" — but it means the
 * component's own output never comes back around, so no test using it can catch
 * a row that disagrees with what was just saved. This helper is the other half.
 *
 * `stored()` decodes the current settings value with `parseReminders`, so
 * persistence assertions still go through the model, never the raw string.
 */
async function renderLiveSection(initial: Partial<Settings> = {}) {
    let live: Settings = { ...baseSettings, ...initial };
    let rerender: (() => void) | null = null;

    mockSettings.mockImplementation(() => live);
    mockUpdateSetting.mockImplementation(async (key: string, value: string) => {
        live = { ...live, [key]: value } as Settings;
        rerender?.();
    });

    function LiveHost() {
        // Assigning during render is fine for a test host: it only has to be in
        // place before the first gesture, and every render refreshes it.
        const [, force] = React.useReducer((n: number) => n + 1, 0);
        rerender = force;
        return (
            <OverlayProvider>
                <RemindersSection />
            </OverlayProvider>
        );
    }

    const view = await render(<LiveHost />);
    return { view, stored: () => parseReminders(live.reminders) };
}

/** The most recent `updateSetting('reminders', <json>)` call, decoded. */
function lastPersistedReminders(): Reminder[] {
    const calls = mockUpdateSetting.mock.calls;
    const [key, json] = calls[calls.length - 1];
    expect(key).toBe('reminders');
    return parseReminders(json);
}

beforeEach(() => {
    mockUpdateSetting.mockClear();
    // renderLiveSection installs a write-back implementation; put the black-hole
    // default back so the static-settings tests below are unaffected by order.
    mockUpdateSetting.mockImplementation(async () => {});
    mockRequestPermission.mockReset();
    mockRequestPermission.mockResolvedValue(true);
    mockSettings.mockReset();
    mockSettings.mockReturnValue({ ...baseSettings });
});

describe('RemindersSection — empty / list / corrupt render states', () => {
    it('empty list shows the empty-state copy and an enabled Add button', async () => {
        mockSettings.mockReturnValue({ ...baseSettings, reminders: '[]' });
        const view = await renderSection();

        expect(view.getByTestId('reminders-empty')).toBeTruthy();
        expect(view.getByText('Add reminder')).toBeTruthy();
    });

    it('renders one row per stored reminder, ordered EARLIEST TIME FIRST regardless of storage order', async () => {
        const stored = [
            makeReminder({ id: 'reminder-3', label: 'Evening reflection', time: '20:00' }),
            makeReminder({ id: 'reminder-1', label: 'Morning check-in', time: '08:00' }),
            makeReminder({ id: 'reminder-2', label: 'Afternoon nudge', time: '13:30' }),
        ];
        mockSettings.mockReturnValue({ ...baseSettings, reminders: serializeReminders(stored) });
        const view = await renderSection();

        const rows = view.getAllByTestId(/^reminder-row-/);
        expect(rows.map(r => r.props.testID)).toEqual([
            'reminder-row-reminder-1',
            'reminder-row-reminder-2',
            'reminder-row-reminder-3',
        ]);

        expect(view.getByText('Morning check-in')).toBeTruthy();
        expect(view.getByText('Afternoon nudge')).toBeTruthy();
        expect(view.getByText('Evening reflection')).toBeTruthy();
        expect(view.getByText(formatTimeForDisplay('08:00'))).toBeTruthy();
    });

    it('a reminder with an empty label falls back to the default "Reminder" display label', async () => {
        mockSettings.mockReturnValue({
            ...baseSettings,
            reminders: serializeReminders([makeReminder({ label: '' })]),
        });
        const view = await renderSection();

        expect(view.getByText('Reminder')).toBeTruthy();
    });

    it('a CORRUPT stored value renders the empty state instead of crashing', async () => {
        mockSettings.mockReturnValue({ ...baseSettings, reminders: 'not json' });
        const view = await renderSection();

        expect(view.getByTestId('reminders-empty')).toBeTruthy();
    });
});

describe('RemindersSection — toggle: permission gating', () => {
    it('toggling ON with permission GRANTED persists that reminder enabled:true and leaves every other reminder untouched', async () => {
        mockRequestPermission.mockResolvedValue(true);
        const stored = [
            makeReminder({ id: 'reminder-1', enabled: false }),
            makeReminder({ id: 'reminder-2', label: 'Evening reflection', time: '20:00', enabled: false }),
        ];
        mockSettings.mockReturnValue({ ...baseSettings, reminders: serializeReminders(stored) });
        const view = await renderSection();

        await fireEvent(view.getByTestId('reminder-toggle-reminder-1'), 'valueChange', true);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalled());

        expect(mockRequestPermission).toHaveBeenCalled();
        const persisted = lastPersistedReminders();
        expect(persisted.find(r => r.id === 'reminder-1')?.enabled).toBe(true);
        // The other reminder's own (false) state is untouched, not flipped.
        expect(persisted.find(r => r.id === 'reminder-2')?.enabled).toBe(false);
    });

    it('toggling ON when permission is DENIED persists nothing and surfaces the blocked-notifications note', async () => {
        mockRequestPermission.mockResolvedValue(false);
        mockSettings.mockReturnValue({
            ...baseSettings,
            reminders: serializeReminders([makeReminder({ id: 'reminder-1', enabled: false })]),
        });
        const view = await renderSection();

        expect(view.queryByTestId('reminders-permission-note')).toBeNull();

        await fireEvent(view.getByTestId('reminder-toggle-reminder-1'), 'valueChange', true);
        await waitFor(() => expect(view.getByTestId('reminders-permission-note')).toBeTruthy());

        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('toggling OFF never requests permission, and persists enabled:false', async () => {
        mockSettings.mockReturnValue({
            ...baseSettings,
            reminders: serializeReminders([makeReminder({ id: 'reminder-1', enabled: true })]),
        });
        const view = await renderSection();

        await fireEvent(view.getByTestId('reminder-toggle-reminder-1'), 'valueChange', false);
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalled());

        expect(mockRequestPermission).not.toHaveBeenCalled();
        expect(lastPersistedReminders().find(r => r.id === 'reminder-1')?.enabled).toBe(false);
    });
});

describe('RemindersSection — Add / create', () => {
    it('Add opens the editor; Save with a typed label appends a NEW reminder (fresh id), keeping existing ones, and requests permission because it is created enabled', async () => {
        mockRequestPermission.mockResolvedValue(true);
        const existing = [makeReminder({ id: 'reminder-1', label: 'Morning check-in', time: '08:00' })];
        mockSettings.mockReturnValue({ ...baseSettings, reminders: serializeReminders(existing) });
        const view = await renderSection();

        await fireEvent.press(view.getByTestId('reminders-add'));
        expect(view.getByTestId('reminder-editor')).toBeTruthy();

        await fireEvent.changeText(view.getByTestId('reminder-editor-label'), 'Evening reflection');
        await fireEvent.press(view.getByTestId('reminder-editor-save'));
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalled());

        expect(mockRequestPermission).toHaveBeenCalled();
        const persisted = lastPersistedReminders();
        expect(persisted).toHaveLength(2);
        expect(persisted.find(r => r.id === 'reminder-1')).toBeTruthy(); // existing intact
        const created = persisted.find(r => r.id !== 'reminder-1');
        expect(created).toMatchObject({ id: 'reminder-2', label: 'Evening reflection', enabled: true });
    });

    it('saving a new reminder when permission is DENIED still creates it, but disabled', async () => {
        mockRequestPermission.mockResolvedValue(false);
        mockSettings.mockReturnValue({ ...baseSettings, reminders: '[]' });
        const view = await renderSection();

        await fireEvent.press(view.getByTestId('reminders-add'));
        await fireEvent.changeText(view.getByTestId('reminder-editor-label'), 'Night check-in');
        await fireEvent.press(view.getByTestId('reminder-editor-save'));
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalled());

        const persisted = lastPersistedReminders();
        expect(persisted).toHaveLength(1);
        expect(persisted[0]).toMatchObject({ label: 'Night check-in', enabled: false });
    });
});

describe('RemindersSection — edit existing / cancel / delete', () => {
    it('tapping an existing row opens the editor PRE-FILLED with its label; Save updates ONLY that reminder (id + time preserved), no new one is created, and no permission is requested', async () => {
        const stored = [
            makeReminder({ id: 'reminder-1', label: 'Morning check-in', time: '08:00', enabled: true }),
            makeReminder({ id: 'reminder-2', label: 'Evening reflection', time: '20:00', enabled: false }),
        ];
        mockSettings.mockReturnValue({ ...baseSettings, reminders: serializeReminders(stored) });
        const view = await renderSection();

        await fireEvent.press(view.getByTestId('reminder-row-reminder-1'));
        const labelInput = view.getByTestId('reminder-editor-label');
        expect(labelInput.props.value).toBe('Morning check-in');

        await fireEvent.changeText(labelInput, 'Morning ritual');
        await fireEvent.press(view.getByTestId('reminder-editor-save'));
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalled());

        expect(mockRequestPermission).not.toHaveBeenCalled();
        const persisted = lastPersistedReminders();
        expect(persisted).toHaveLength(2);
        const edited = persisted.find(r => r.id === 'reminder-1');
        expect(edited).toMatchObject({ id: 'reminder-1', label: 'Morning ritual', time: '08:00' });
        expect(persisted.find(r => r.id === 'reminder-2')?.label).toBe('Evening reflection');
    });

    it('Cancel closes the editor and persists nothing', async () => {
        mockSettings.mockReturnValue({ ...baseSettings, reminders: '[]' });
        const view = await renderSection();

        await fireEvent.press(view.getByTestId('reminders-add'));
        expect(view.getByTestId('reminder-editor')).toBeTruthy();

        await fireEvent.press(view.getByTestId('reminder-editor-cancel'));

        expect(view.queryByTestId('reminder-editor')).toBeNull();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });

    it('Delete is only offered when editing an EXISTING reminder, and removes exactly that one, keeping the rest', async () => {
        const stored = [
            makeReminder({ id: 'reminder-1', label: 'Morning', time: '08:00' }),
            makeReminder({ id: 'reminder-2', label: 'Evening', time: '20:00' }),
        ];
        mockSettings.mockReturnValue({ ...baseSettings, reminders: serializeReminders(stored) });
        const view = await renderSection();

        // New-reminder editor: no delete affordance.
        await fireEvent.press(view.getByTestId('reminders-add'));
        expect(view.queryByTestId('reminder-editor-delete')).toBeNull();
        await fireEvent.press(view.getByTestId('reminder-editor-cancel'));

        await fireEvent.press(view.getByTestId('reminder-row-reminder-1'));
        expect(view.getByTestId('reminder-editor-delete')).toBeTruthy();
        await fireEvent.press(view.getByTestId('reminder-editor-delete'));
        await waitFor(() => expect(mockUpdateSetting).toHaveBeenCalled());

        const persisted = lastPersistedReminders();
        expect(persisted).toHaveLength(1);
        expect(persisted[0].id).toBe('reminder-2');
    });
});

describe('RemindersSection — MAX_REMINDERS cap', () => {
    it(`disables Add at the cap: pressing it opens nothing and persists nothing, and shows "Maximum ${MAX_REMINDERS} reminders"`, async () => {
        const fullList: Reminder[] = Array.from({ length: MAX_REMINDERS }, (_, i) =>
            makeReminder({
                id: `reminder-${i + 1}`,
                label: `Reminder ${i + 1}`,
                time: `${String(i).padStart(2, '0')}:00`,
            })
        );
        mockSettings.mockReturnValue({ ...baseSettings, reminders: serializeReminders(fullList) });
        const view = await renderSection();

        expect(view.getByText(`Maximum ${MAX_REMINDERS} reminders`)).toBeTruthy();

        // A disabled Pressable correctly no-ops on fireEvent.press in RNTL v14 —
        // this IS the assertion, not a workaround (see docblock).
        await fireEvent.press(view.getByTestId('reminders-add'));
        expect(view.queryByTestId('reminder-editor')).toBeNull();
        expect(mockUpdateSetting).not.toHaveBeenCalled();
    });
});

/**
 * REGRESSION (device QA, 2026-09-03). Reported as "a new reminder's typed name
 * doesn't show in the row — it shows the generic 'Reminder'", with the editor
 * still displaying the name when reopened, i.e. "the data saved fine, the row
 * displays the wrong field".
 *
 * It was neither. The row was right: the saved reminder genuinely had NO name.
 * The name never reached the field (the editor was the one dialog in the app
 * without `autoFocus`, so the keyboard never opened on it), and the placeholder
 * was a plausible value — "Morning check-in" — rendered in the editor both
 * before and after the save, which is what made an empty field read as a saved
 * one. (Confirmed from the QA screenshots: the "name" pixels are
 * `textSecondary`, while a really-typed value in the sibling rename dialog is
 * `text`/pure white.)
 *
 * So these lock the whole loop rather than the reported symptom: what the row
 * shows must equal what was actually saved (both directions), and the editor
 * must be typeable the moment it opens with a placeholder that cannot pass for
 * a value.
 */
describe('RemindersSection — round trip: the row shows what was actually saved', () => {
    it('a newly created reminder shows its TYPED name in the row, not the "Reminder" fallback', async () => {
        const { view, stored } = await renderLiveSection({ reminders: '[]' });

        await fireEvent.press(view.getByTestId('reminders-add'));
        await fireEvent.changeText(view.getByTestId('reminder-editor-label'), 'Morning check-in');
        await fireEvent.press(view.getByTestId('reminder-editor-save'));
        await waitFor(() => expect(view.getAllByTestId(/^reminder-row-/)).toHaveLength(1));

        expect(stored()[0].label).toBe('Morning check-in');
        expect(view.getByText('Morning check-in')).toBeTruthy();
        // 'Reminder' is an exact-match query — the "Reminders" header does not
        // satisfy it, so this really does assert the fallback is absent.
        expect(view.queryByText('Reminder')).toBeNull();
    });

    it('a reminder saved with the name left EMPTY shows the "Reminder" fallback, and reopens with an EMPTY field (the placeholder is not a value)', async () => {
        const { view, stored } = await renderLiveSection({ reminders: '[]' });

        await fireEvent.press(view.getByTestId('reminders-add'));
        await fireEvent.press(view.getByTestId('reminder-editor-save'));
        await waitFor(() => expect(view.getAllByTestId(/^reminder-row-/)).toHaveLength(1));

        expect(stored()[0].label).toBe('');
        expect(view.getByText('Reminder')).toBeTruthy();

        // The exact trap that made QA call this "saved correctly": reopening it.
        await fireEvent.press(view.getAllByTestId(/^reminder-row-/)[0]);
        const input = view.getByTestId('reminder-editor-label');
        expect(input.props.value).toBe('');
        expect(input.props.placeholder).toMatch(/^e\.g\. /);
    });

    it('renaming an existing reminder updates its row immediately', async () => {
        const { view } = await renderLiveSection({
            reminders: serializeReminders([makeReminder({ id: 'reminder-1', label: 'Morning check-in' })]),
        });

        await fireEvent.press(view.getByTestId('reminder-row-reminder-1'));
        await fireEvent.changeText(view.getByTestId('reminder-editor-label'), 'Morning ritual');
        await fireEvent.press(view.getByTestId('reminder-editor-save'));

        await waitFor(() => expect(view.getByText('Morning ritual')).toBeTruthy());
        expect(view.queryByText('Morning check-in')).toBeNull();
    });
});

describe('RemindersSection — the editor is typeable the moment it opens', () => {
    /**
     * `fireEvent.changeText` types into a field whether or not it could ever
     * hold focus on a device, so these props are the only thing standing
     * between "the suite is green" and "the user opens the dialog, types, and
     * nothing lands". Every other text dialog in this app (GroupManageDialogs,
     * ActivityEditModal, ActivitySelector) already autoFocuses — the reminder
     * editor was the lone exception.
     */
    it.each([
        ['a new reminder', async (view: Awaited<ReturnType<typeof renderLiveSection>>['view']) =>
            fireEvent.press(view.getByTestId('reminders-add'))],
        ['an existing reminder', async (view: Awaited<ReturnType<typeof renderLiveSection>>['view']) =>
            fireEvent.press(view.getByTestId('reminder-row-reminder-1'))],
    ])('focuses the Name field when opened for %s, with an example placeholder', async (_case, open) => {
        const { view } = await renderLiveSection({
            reminders: serializeReminders([makeReminder({ id: 'reminder-1' })]),
        });

        await open(view);

        const input = view.getByTestId('reminder-editor-label');
        expect(input.props.autoFocus).toBe(true);
        // An "e.g." prefix is what keeps an empty field from reading as a filled
        // one; a bare "Morning check-in" is exactly what fooled on-device QA.
        expect(input.props.placeholder).toMatch(/^e\.g\. /);
    });
});

describe('RemindersSection — theme', () => {
    it('renders under the LIGHT theme without crashing', async () => {
        mockSettings.mockReturnValue({
            ...baseSettings,
            theme: 'light',
            reminders: serializeReminders([makeReminder()]),
        });
        const view = await renderSection();

        expect(view.getByText('Morning check-in')).toBeTruthy();
    });
});
