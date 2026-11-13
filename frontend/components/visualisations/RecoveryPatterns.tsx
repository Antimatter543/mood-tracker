import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { Card } from '@/components/Card';
import InfoBubble from '@/components/InfoBubble';
import { OverlayModal } from '@/components/OverlayModal';
import RecoveryEpisodeDetails from '@/components/RecoveryEpisodeDetails';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useDateFormat } from '@/hooks/useDateFormat';
import { addDays, localDateString, startOfLocalDay } from '@/databases/dateHelpers';
import { now } from '@/lib/clock';
import { RECOVERY_ENTRY_ACTIVITIES } from './queries';
import {
    analyseRecoveryPatterns,
    groupRecoveryRows,
    LOW_STRETCH_EXPLAINER,
    type RecoveryAnalysis,
    type RecoveryEpisode,
    type RecoveryRawRow,
} from './transforms/recoveryPatterns';
import {
    daysLabel,
    daysSoFar,
    moodRangeLine,
    statusLabel,
    summaryLine,
    typicalLine,
} from './transforms/lowStretchCopy';

/** How far back the card looks. The copy says "last 90 days". */
const WINDOW_DAYS = 90;
/** Ended stretches listed on the card; the rest are counted in the summary. */
const MAX_ROWS = 5;

/**
 * "After low days": low stretches in the last 90 days and how they ended.
 *
 * Self-loading (its own 90-day query), and renders NOTHING until there is at
 * least one low stretch: no card, no empty message, no (i).
 */
const RecoveryAnalysisCard = () => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const { format: formatDate } = useDateFormat();
    const db = useSQLiteContext();
    const [analysis, setAnalysis] = useState<RecoveryAnalysis | null>(null);
    const [selected, setSelected] = useState<RecoveryEpisode | null>(null);

    const load = useCallback(async () => {
        try {
            // LOCAL start of the day 90 days ago, as a UTC instant bound.
            const start = startOfLocalDay(addDays(localDateString(now()), -WINDOW_DAYS));
            const raw = await db.getAllAsync<RecoveryRawRow>(RECOVERY_ENTRY_ACTIVITIES, [start]);
            setAnalysis(analyseRecoveryPatterns(groupRecoveryRows(raw ?? [])));
        } catch (error) {
            console.error('Error loading low stretches:', error);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- query reads only db; setState identities are stable
    }, [db]);
    useDataRefresh(load, [db]);

    if (!analysis || analysis.episodeCount === 0) return null;

    const dateRange = (episode: RecoveryEpisode) =>
        `${formatDate(episode.startDate, 'mediumNoYear')} – ${
            episode.endDate ? formatDate(episode.endDate, 'mediumNoYear') : 'now'
        }`;

    const current = analysis.currentEpisode;
    const typical = typicalLine(analysis);
    const today = localDateString(now());

    return (
        <Card>
            {/* InfoBubble is absolutely positioned (top-right) by the component. */}
            <InfoBubble text={LOW_STRETCH_EXPLAINER} />

            <View style={styles.headerRow}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accentLight }]}>
                    <Ionicons name="partly-sunny-outline" size={20} color={colors.accent} />
                </View>
                <Text style={styles.title}>After low days</Text>
            </View>

            <Text style={styles.body} testID="low-stretch-summary">
                {summaryLine(analysis.episodeCount)}
            </Text>
            {typical && (
                <Text style={styles.body} testID="low-stretch-typical">
                    {typical}
                </Text>
            )}

            {current && (
                <Pressable
                    testID="low-stretch-current"
                    style={({ pressed }) => [styles.row, styles.currentRow, pressed && styles.pressed]}
                    onPress={() => setSelected(current)}
                    accessibilityRole="button"
                    accessibilityLabel={`Low stretch since ${formatDate(current.startDate, 'mediumNoYear')}, ${daysLabel(daysSoFar(current.startDate, today))} so far. Opens details.`}
                >
                    <View style={styles.grow}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                            Since {formatDate(current.startDate, 'mediumNoYear')}
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                            {daysLabel(daysSoFar(current.startDate, today))} so far
                        </Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                            {moodRangeLine(current)}
                        </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </Pressable>
            )}

            {analysis.historicalEpisodes.length > 0 && (
                <View style={styles.list}>
                    {analysis.historicalEpisodes.slice(0, MAX_ROWS).map((episode, index) => (
                        <Pressable
                            key={`${episode.startDate}-${index}`}
                            testID={`low-stretch-row-${index}`}
                            style={({ pressed }) => [
                                styles.row,
                                index > 0 && styles.divider,
                                pressed && styles.pressed,
                            ]}
                            onPress={() => setSelected(episode)}
                            accessibilityRole="button"
                            accessibilityLabel={`Low stretch ${dateRange(episode).replace('–', 'to')}, ${statusLabel(episode).toLowerCase()}. Opens details.`}
                        >
                            <Text style={[styles.rowTitle, styles.grow]} numberOfLines={1}>
                                {dateRange(episode)}
                            </Text>
                            <Text style={styles.status} numberOfLines={1}>
                                {statusLabel(episode)}
                            </Text>
                            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                        </Pressable>
                    ))}
                </View>
            )}

            <OverlayModal visible={selected !== null} onClose={() => setSelected(null)} fullScreen>
                {selected && (
                    <RecoveryEpisodeDetails episode={selected} onClose={() => setSelected(null)} />
                )}
            </OverlayModal>
        </Card>
    );
};

export default RecoveryAnalysisCard;

// Header/title/body mirror MoodDriversCard, the neighbour above on Insights.
const useThemedStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                headerRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 12,
                    // leave room for the absolutely-positioned InfoBubble
                    paddingRight: 36,
                },
                iconCircle: {
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                title: {
                    fontSize: 16,
                    fontWeight: '700',
                    color: colors.text,
                    flex: 1,
                },
                body: {
                    fontSize: 15,
                    lineHeight: 22,
                    color: colors.textSecondary,
                },
                grow: { flex: 1, minWidth: 0 },
                row: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: 48,
                    paddingVertical: 10,
                },
                currentRow: {
                    marginTop: 12,
                    paddingHorizontal: 12,
                    borderRadius: 16,
                    backgroundColor: colors.accentLight,
                },
                list: {
                    marginTop: 8,
                },
                divider: {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.overlays.border,
                },
                pressed: { opacity: 0.6 },
                rowTitle: {
                    fontSize: 15,
                    fontWeight: '600',
                    color: colors.text,
                },
                rowSub: {
                    fontSize: 14,
                    lineHeight: 20,
                    color: colors.textSecondary,
                },
                status: {
                    fontSize: 14,
                    color: colors.textSecondary,
                    flexShrink: 0,
                },
            }),
        [colors]
    );
