// calendarMarkers.ts
//
// Builds the `markedDates` dict consumed by `react-native-calendars`.
//
// The library expects keys in "YYYY-MM-DD" format (matches our SQL output).
// Each value uses `markingType="custom"` shape:
//   { customStyles: { container: {...}, text: {...} } }

export type MoodMarkerRow = {
    date: string;            // "YYYY-MM-DD"
    avgMood: number | null;
};

export type MoodMarking = {
    [date: string]: {
        customStyles: {
            container: { backgroundColor: string };
            text: { color: string };
        };
    };
};

/**
 * Map a 0..10 mood value to a discrete colour. Values outside the range are
 * clamped. `null` is treated as "no marker".
 */
export const moodToColor = (mood: number): string => {
    if (mood >= 8) return '#4CAF50';
    if (mood >= 6) return '#8BC34A';
    if (mood >= 4) return '#FFC107';
    if (mood >= 2) return '#FF9800';
    return '#F44336';
};

/**
 * Build the marker dict. Skips entries with `avgMood === null`.
 */
export const buildCalendarMarkers = (rows: MoodMarkerRow[]): MoodMarking => {
    const markers: MoodMarking = {};
    for (const row of rows) {
        if (row.avgMood === null || row.avgMood === undefined) continue;
        if (!Number.isFinite(row.avgMood)) continue;
        markers[row.date] = {
            customStyles: {
                container: { backgroundColor: moodToColor(row.avgMood) },
                text: { color: '#FFFFFF' },
            },
        };
    }
    return markers;
};
