import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { ThemeColors } from '@/styles/global';

/**
 * The footer's height, CONSTANT across all three states. It used to be a spinner
 * that was mounted while a page loaded and unmounted after, so every page append
 * changed the content height twice — and a content height that SHRINKS while the
 * user is at the end of the list makes Android clamp the scroll offset. Reserving
 * the space permanently makes the footer invisible to the list's geometry.
 */
export const TIMELINE_FOOTER_HEIGHT = 64;

export type TimelineFooterState = 'loading' | 'end' | 'idle';

/** Which footer to show. Pure, so the state table is unit-tested. */
export const footerStateFor = (
    isLoadingMore: boolean,
    hasMore: boolean,
    entryCount: number
): TimelineFooterState => {
    if (isLoadingMore) return 'loading';
    if (!hasMore && entryCount > 0) return 'end';
    return 'idle';
};

const styles = StyleSheet.create({
    footer: {
        height: TIMELINE_FOOTER_HEIGHT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    end: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    endText: {
        fontSize: 13,
        fontWeight: '500',
    },
});

/**
 * Bottom of the Timeline: a spinner while the next page loads, a quiet "start of
 * your timeline" marker once there is nothing older, otherwise empty space —
 * always the same height (see TIMELINE_FOOTER_HEIGHT).
 */
export const TimelineFooter: React.FC<{ state: TimelineFooterState; colors: ThemeColors }> = ({
    state,
    colors,
}) => (
    <View style={styles.footer} testID="timeline-footer">
        {state === 'loading' ? (
            <ActivityIndicator size="small" color={colors.accent} />
        ) : state === 'end' ? (
            <View style={styles.end}>
                <Feather name="flag" size={14} color={colors.textSecondary} />
                <Text style={[styles.endText, { color: colors.textSecondary }]}>
                    The start of your timeline
                </Text>
            </View>
        ) : null}
    </View>
);
