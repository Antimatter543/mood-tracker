/**
 * Tapping a SoulSync reminder notification opens the entry form from the FAB.
 * A tap while the form is already open is a no-op (stays open, one form), and
 * the subscription is released on unmount.
 */
import { render, act } from '@testing-library/react-native';

jest.mock('@/styles/global', () => require('@/testing/theme').mockThemeModule());
jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => ({}) }));
jest.mock('@/context/DataContext', () => ({ useDataContext: () => ({ refetchEntries: jest.fn() }) }));
jest.mock('@/context/SettingsContext', () => ({
    useSettings: () => ({ settings: { fab_position: 'right' } }),
}));
jest.mock('expo-router', () => {
    const ReactActual = require('react');
    return { useFocusEffect: (cb: () => void) => ReactActual.useEffect(() => cb(), [cb]) };
});

// Render the modal's visibility + count of mounted forms as plain props.
const mockForms: { visible: boolean }[] = [];
jest.mock('@/components/forms/EntryForm', () => ({
    EntryFormModal: (props: { visible: boolean }) => {
        mockForms.push({ visible: props.visible });
        return null;
    },
}));

let mockTapHandler: (() => void) | null = null;
const mockUnsubscribe = jest.fn();
jest.mock('@/lib/notifications', () => ({
    subscribeToReminderTaps: (h: () => void) => {
        mockTapHandler = h;
        return mockUnsubscribe;
    },
    dismissNotifications: jest.fn(),
}));

import { AddEntryButton } from '@/components/AddEntryButton';

const lastVisible = () => mockForms.at(-1)!.visible;

describe('AddEntryButton reminder tap', () => {
    beforeEach(() => {
        mockForms.length = 0;
        mockTapHandler = null;
        mockUnsubscribe.mockClear();
    });

    it('opens the entry form when a reminder is tapped', async () => {
        await render(<AddEntryButton />);
        expect(lastVisible()).toBe(false);
        await act(async () => mockTapHandler!());
        expect(lastVisible()).toBe(true);
    });

    it('a second tap while the form is open leaves it open (no-op)', async () => {
        await render(<AddEntryButton />);
        await act(async () => mockTapHandler!());
        const rendersAfterFirst = mockForms.length;
        await act(async () => mockTapHandler!());
        expect(lastVisible()).toBe(true);
        expect(mockForms.length).toBe(rendersAfterFirst); // no extra render: state unchanged
    });

    it('releases the subscription on unmount', async () => {
        const view = await render(<AddEntryButton />);
        await view.unmount();
        expect(mockUnsubscribe).toHaveBeenCalled();
    });
});
