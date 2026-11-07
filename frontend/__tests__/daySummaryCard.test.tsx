/**
 * The calendar's day summary card. Its layout is device-only (docs/TESTING.md L2 and the OV case
 * in docs/device-qa-checklist.md); what jest can pin is who catches a touch in the list.
 *
 * Bug this guards (2026-11-08, Pixel pass on 8c0daa1): the responder sat on each row, so a drag
 * that started in the 10 dp gap between rows landed on the card's Pressable and did not scroll.
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { DaySummaryCard, makeStyles } from '@/components/visualisations/MoodCalendar';
import type { DaySummary } from '@/components/visualisations/transforms/daySummary';
import { themeColors } from '@/styles/global';

jest.mock('@/hooks/useDataRefresh', () => ({ useDataRefresh: jest.fn() }));

const colors = themeColors.dark;
const styles = makeStyles(colors);

const summaryOf = (moods: number[]): DaySummary => ({
  day: '2026-03-02',
  count: moods.length,
  avgMood: moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null,
  entries: moods.map((mood, i) => ({
    id: i + 1,
    instant: `2026-03-02T0${i}:00:00.000Z`,
    mood,
    activities: i === 0 ? ['Walk'] : [],
  })),
});

const renderCard = (summary: DaySummary) =>
  render(
    <DaySummaryCard
      summary={summary}
      onClose={() => {}}
      styles={styles}
      colors={colors}
      dateFormatPref="ymd"
    />,
  );

describe('DaySummaryCard', () => {
  it('catches a touch on one view around every row, so the gaps between rows scroll too', async () => {
    const view = await renderCard(summaryOf([2, 4, 6, 8]));
    const rows = view.getByTestId('day-summary-rows');

    expect(rows.props.onStartShouldSetResponder()).toBe(true);
    for (const mood of ['2', '4', '6', '8']) {
      let node = view.getByText(mood).parent;
      while (node && node !== rows) node = node.parent;
      expect(node).toBe(rows);
    }
  });

  it('spaces the rows inside that view, not on the scroll content outside it', () => {
    expect(styles.summaryRows.gap).toBe(10);
    expect(styles.summaryListContent).not.toHaveProperty('gap');
  });

  it('shows the empty state and no list on a day with no entries', async () => {
    const view = await renderCard(summaryOf([]));
    expect(view.queryByTestId('day-summary-rows')).toBeNull();
  });
});
