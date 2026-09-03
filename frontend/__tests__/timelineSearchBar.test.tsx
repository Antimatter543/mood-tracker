/**
 * Behavioural tests for the Timeline search + mood-filter bar (RNTL).
 *
 * The bar is presentational — it holds no state — so these assert the wiring:
 *   - all mood chips render,
 *   - typing fires onQueryChange with the text,
 *   - the clear button appears ONLY when the query is non-empty and clears via
 *     onQueryChange(''),
 *   - tapping a mood chip fires onMoodPresetChange with that chip's key,
 *   - the selected chip carries accessibilityState.selected === true.
 *
 * @expo/vector-icons Feather renders under jest-expo without a mock (see
 * entryCard.test.tsx), so the real component tree is exercised.
 */
import { render, fireEvent } from '@testing-library/react-native';
import type { ThemeColors } from '@/styles/global';
import { TimelineSearchBar } from '@/components/timeline/TimelineSearchBar';
import { MOOD_PRESETS, MoodPresetKey } from '@/components/timeline/entryFilter';

const colors: ThemeColors = {
    background: '#000',
    cardBackground: '#111',
    secondaryBackground: '#222',
    text: '#fff',
    textSecondary: '#aaa',
    border: '#333',
    accent: '#4CAF50',
    accentDark: '#388E3C',
    accentLight: 'rgba(76,175,80,0.1)',
    overlays: { tag: '#222', tagBorder: '#333', border: '#333', textSecondary: '#aaa' },
    elevation: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
    isDark: true,
};

type Overrides = {
    query?: string;
    moodPresetKey?: MoodPresetKey;
    starredOnly?: boolean;
    onQueryChange?: (t: string) => void;
    onMoodPresetChange?: (k: MoodPresetKey) => void;
    onStarredChange?: (v: boolean) => void;
    binCount?: number;
    onOpenBin?: () => void;
};

const renderBar = async (over: Overrides = {}) => {
    const onQueryChange = over.onQueryChange ?? jest.fn();
    const onMoodPresetChange = over.onMoodPresetChange ?? jest.fn();
    const onStarredChange = over.onStarredChange ?? jest.fn();
    const onOpenBin = over.onOpenBin ?? jest.fn();
    // RNTL 14 render() is async — await it before spreading its queries.
    const result = await render(
        <TimelineSearchBar
            query={over.query ?? ''}
            onQueryChange={onQueryChange}
            moodPresetKey={over.moodPresetKey ?? 'all'}
            onMoodPresetChange={onMoodPresetChange}
            starredOnly={over.starredOnly ?? false}
            onStarredChange={onStarredChange}
            binCount={over.binCount ?? 0}
            onOpenBin={onOpenBin}
            colors={colors}
        />
    );
    return { ...result, onQueryChange, onMoodPresetChange, onStarredChange, onOpenBin };
};

describe('TimelineSearchBar', () => {
    it('renders the search input and every mood chip', async () => {
        const { getByTestId } = await renderBar();
        expect(getByTestId('timeline-search-input')).toBeTruthy();
        for (const preset of MOOD_PRESETS) {
            expect(getByTestId(`mood-filter-${preset.key}`)).toBeTruthy();
        }
    });

    it('fires onQueryChange with the typed text', async () => {
        const { getByTestId, onQueryChange } = await renderBar();
        fireEvent.changeText(getByTestId('timeline-search-input'), 'gym run');
        expect(onQueryChange).toHaveBeenCalledWith('gym run');
    });

    it('hides the clear button when the query is empty', async () => {
        const { queryByTestId } = await renderBar({ query: '' });
        expect(queryByTestId('timeline-search-clear')).toBeNull();
    });

    it('shows the clear button when the query is non-empty and clears via onQueryChange("")', async () => {
        const { getByTestId, onQueryChange } = await renderBar({ query: 'anx' });
        const clear = getByTestId('timeline-search-clear');
        expect(clear).toBeTruthy();
        fireEvent.press(clear);
        expect(onQueryChange).toHaveBeenCalledWith('');
    });

    it('fires onMoodPresetChange with the tapped chip key', async () => {
        const { getByTestId, onMoodPresetChange } = await renderBar();
        fireEvent.press(getByTestId('mood-filter-high'));
        expect(onMoodPresetChange).toHaveBeenCalledWith('high');
    });

    it('marks only the selected chip with accessibilityState.selected', async () => {
        const { getByTestId } = await renderBar({ moodPresetKey: 'mid' });
        expect(getByTestId('mood-filter-mid').props.accessibilityState.selected).toBe(true);
        expect(getByTestId('mood-filter-all').props.accessibilityState.selected).toBe(false);
        expect(getByTestId('mood-filter-low').props.accessibilityState.selected).toBe(false);
    });

    describe('starred filter chip', () => {
        it('renders the "Starred" chip alongside the mood chips', async () => {
            const { getByTestId, getByText } = await renderBar();
            expect(getByTestId('timeline-filter-starred')).toBeTruthy();
            expect(getByText('Starred')).toBeTruthy();
        });

        it('toggles ON: fires onStarredChange(true) when it is currently off', async () => {
            const { getByTestId, onStarredChange } = await renderBar({ starredOnly: false });
            fireEvent.press(getByTestId('timeline-filter-starred'));
            expect(onStarredChange).toHaveBeenCalledWith(true);
        });

        it('toggles OFF: fires onStarredChange(false) when it is currently on', async () => {
            const { getByTestId, onStarredChange } = await renderBar({ starredOnly: true });
            fireEvent.press(getByTestId('timeline-filter-starred'));
            expect(onStarredChange).toHaveBeenCalledWith(false);
        });

        it('reflects starredOnly in accessibilityState.selected', async () => {
            const on = await renderBar({ starredOnly: true });
            expect(on.getByTestId('timeline-filter-starred').props.accessibilityState.selected).toBe(true);
            const off = await renderBar({ starredOnly: false });
            expect(off.getByTestId('timeline-filter-starred').props.accessibilityState.selected).toBe(false);
        });

        it('is INDEPENDENT of the mood presets (a mood chip stays selectable while starred is on)', async () => {
            // Composition guard: starred active must not disable / hijack the mood
            // chip taps — the two filters combine.
            const { getByTestId, onMoodPresetChange } = await renderBar({ starredOnly: true });
            fireEvent.press(getByTestId('mood-filter-high'));
            expect(onMoodPresetChange).toHaveBeenCalledWith('high');
        });
    });
});
