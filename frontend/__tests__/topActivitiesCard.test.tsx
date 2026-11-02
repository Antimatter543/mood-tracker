/**
 * TopActivitiesCard ("What lifts your mood" on Insights).
 *
 * Regression for PR #24: the empty-state hint ("Log activities alongside your
 * mood...") must render when no activity lifts mood. The first cut of the
 * multi-activity change used `slice(0, 3) ?? fallback`, and slice never yields
 * null, so new users saw a blank card. Covers 0, 1 and 3 activities.
 *
 * Follows the useThemeColors mock pattern of healthMoodPagerCard.test.tsx.
 */
import { render } from '@testing-library/react-native';

jest.mock('@/styles/global', () => {
    const actual = jest.requireActual('@/styles/global');
    return {
        ...actual,
        useThemeColors: () => ({
            background: '#141418',
            cardBackground: '#1E1F24',
            secondaryBackground: '#26272C',
            text: '#FFFFFF',
            textSecondary: '#AAAAAA',
            border: 'rgba(255,255,255,0.1)',
            accent: '#4CAF50',
            accentDark: '#3d8b40',
            accentLight: 'rgba(76,175,80,0.1)',
            overlays: {
                tag: '#222222',
                tagBorder: '#333333',
                border: '#333333',
                textSecondary: '#888888',
            },
            elevation: { shadowColor: '#000000', shadowOpacity: 0.3, elevation: 4 },
            isDark: true,
        }),
    };
});

import TopActivitiesCard, { type TopActivity } from '@/components/visualisations/TopActivitiesCard';

const EMPTY_HINT = /Log activities alongside your mood/;

const act = (name: string, delta: number): TopActivity => ({
    name,
    avgWith: 4 + delta,
    avgWithout: 4,
    delta,
});

describe('TopActivitiesCard', () => {
    it('shows the title and the empty-state hint when there are no activities', async () => {
        const { getByText } = await render(<TopActivitiesCard activities={[]} />);
        expect(getByText('What lifts your mood')).toBeTruthy();
        expect(getByText(EMPTY_HINT)).toBeTruthy();
    });

    it('renders one sentence and no empty hint for a single activity', async () => {
        const { getByText, queryByText, queryAllByText } = await render(
            <TopActivitiesCard activities={[act('Walking', 1.5)]} />
        );
        expect(getByText('Walking')).toBeTruthy();
        expect(getByText('+1.5')).toBeTruthy(); // delta, 1 decimal
        expect(getByText('5.5')).toBeTruthy(); // avgWith
        expect(queryAllByText(/When you log/)).toHaveLength(1);
        expect(queryByText(EMPTY_HINT)).toBeNull();
    });

    it('renders one sentence per activity for three', async () => {
        const { getAllByText, getByText, queryByText } = await render(
            <TopActivitiesCard
                activities={[act('Walking', 1.5), act('Reading', 1.0), act('Cooking', 0.5)]}
            />
        );
        expect(getAllByText(/When you log/)).toHaveLength(3);
        ['Walking', 'Reading', 'Cooking'].forEach((n) => expect(getByText(n)).toBeTruthy());
        expect(queryByText(EMPTY_HINT)).toBeNull();
    });
});
