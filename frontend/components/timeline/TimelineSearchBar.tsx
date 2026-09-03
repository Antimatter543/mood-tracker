import { useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView,
    StyleSheet,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ThemeColors } from '@/styles/global';
import { LAYOUT_CONTENT_PADDING } from '@/styles/layout';
import { MOOD_PRESETS, MoodPresetKey } from './entryFilter';

type TimelineSearchBarProps = {
    query: string;
    onQueryChange: (t: string) => void;
    moodPresetKey: MoodPresetKey;
    onMoodPresetChange: (k: MoodPresetKey) => void;
    /** Whether the "Starred only" filter chip is active. */
    starredOnly: boolean;
    /** Toggle the "Starred only" filter (independent of search + mood presets). */
    onStarredChange: (v: boolean) => void;
    /** How many entries sit in the recycle bin, drives the button's badge. */
    binCount: number;
    /** Open the "Recently deleted" panel. */
    onOpenBin: () => void;
    colors: ThemeColors;
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                // Pinned above the list with a bottom hairline separating it from
                // the scrolling entries. Solid theme background so nothing bleeds
                // through as rows scroll under it.
                container: {
                    // Same gutter as the Timeline page title above it and as the
                    // entry list below it — see styles/layout.ts.
                    paddingHorizontal: LAYOUT_CONTENT_PADDING,
                    paddingTop: 8,
                    paddingBottom: 12,
                    backgroundColor: colors.background,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                },
                // Search pill + the bin button share one row; the pill flexes so
                // the bin button keeps a fixed 44x44 tap target on every width.
                searchRow: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                },
                searchPill: {
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: 44,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: colors.secondaryBackground,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
                },
                binButton: {
                    width: 44,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    backgroundColor: colors.secondaryBackground,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
                },
                // Count badge pinned to the button's top-right corner. Only shown
                // when the bin is non-empty, so an empty bin stays visually quiet.
                binBadge: {
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    minWidth: 18,
                    height: 18,
                    paddingHorizontal: 4,
                    borderRadius: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: colors.accent,
                },
                binBadgeText: {
                    color: colors.background,
                    fontSize: 11,
                    fontWeight: '700',
                },
                searchIcon: {
                    marginRight: 8,
                },
                input: {
                    flex: 1,
                    color: colors.text,
                    fontSize: 15,
                    // Kill Android's default vertical padding so the single line
                    // stays centered in the 44px pill.
                    paddingVertical: 0,
                },
                clearButton: {
                    padding: 4,
                    marginLeft: 4,
                },
                chipScroll: {
                    marginTop: 10,
                },
                chipScrollContent: {
                    gap: 8,
                    // Trailing breathing room so the last chip clears the edge
                    // when the row scrolls horizontally.
                    paddingRight: 16,
                },
                chip: {
                    paddingHorizontal: 14,
                    paddingVertical: 7,
                    borderRadius: 999,
                    borderWidth: StyleSheet.hairlineWidth,
                },
                chipText: {
                    fontSize: 13,
                    fontWeight: '600',
                },
                // The starred chip pairs a small star glyph with its label, so
                // its inner content lays out as a row (mood chips are text-only).
                starChipContent: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                },
            }),
        [colors]
    );

/**
 * Pinned search + mood-filter bar above the Timeline list. Purely
 * presentational — all state lives in DBViewer; this only renders the current
 * query / preset and fires callbacks. Themed entirely through `colors` (no
 * hardcoded palette), so it tracks every theme (dark / light / cherry / ...).
 */
export function TimelineSearchBar({
    query,
    onQueryChange,
    moodPresetKey,
    onMoodPresetChange,
    starredOnly,
    onStarredChange,
    binCount,
    onOpenBin,
    colors,
}: TimelineSearchBarProps) {
    const styles = useStyles(colors);

    return (
        <View style={styles.container}>
            <View style={styles.searchRow}>
            <View style={styles.searchPill}>
                <Feather
                    name="search"
                    size={18}
                    color={colors.textSecondary}
                    style={styles.searchIcon}
                />
                <TextInput
                    testID="timeline-search-input"
                    style={styles.input}
                    value={query}
                    onChangeText={onQueryChange}
                    placeholder="Search notes & activities"
                    placeholderTextColor={colors.textSecondary}
                    returnKeyType="search"
                    autoCorrect={false}
                    autoCapitalize="none"
                />
                {query.length > 0 ? (
                    <Pressable
                        testID="timeline-search-clear"
                        onPress={() => onQueryChange('')}
                        accessibilityRole="button"
                        accessibilityLabel="Clear search"
                        style={styles.clearButton}
                        hitSlop={8}
                    >
                        <Feather name="x" size={18} color={colors.textSecondary} />
                    </Pressable>
                ) : null}
            </View>
            {/* Entry point to the recycle bin. Lives beside the search field
                rather than in the navigator header so the whole feature stays
                inside the Timeline's own tree (no shared-layout coupling), and
                so its badge can react to the same data-version bump the list does. */}
            <Pressable
                testID="timeline-open-bin"
                onPress={onOpenBin}
                accessibilityRole="button"
                accessibilityLabel={
                    binCount > 0
                        ? `Recently deleted, ${binCount} ${binCount === 1 ? 'entry' : 'entries'}`
                        : 'Recently deleted'
                }
                style={styles.binButton}
                hitSlop={4}
            >
                <Feather name="trash-2" size={18} color={colors.textSecondary} />
                {binCount > 0 ? (
                    <View style={styles.binBadge}>
                        <Text style={styles.binBadgeText}>
                            {binCount > 99 ? '99+' : binCount}
                        </Text>
                    </View>
                ) : null}
            </Pressable>
            </View>

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipScrollContent}
                keyboardShouldPersistTaps="handled"
            >
                {/* "Starred" toggle at the FRONT of the row — an independent
                    filter that composes with search + the mood presets. */}
                <Pressable
                    testID="timeline-filter-starred"
                    onPress={() => onStarredChange(!starredOnly)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: starredOnly }}
                    accessibilityLabel="Filter starred entries"
                    style={[
                        styles.chip,
                        {
                            backgroundColor: starredOnly
                                ? colors.accentLight
                                : colors.overlays.tag,
                            borderColor: starredOnly
                                ? colors.accent
                                : colors.overlays.tagBorder,
                        },
                    ]}
                >
                    <View style={styles.starChipContent}>
                        <MaterialCommunityIcons
                            name={starredOnly ? 'star' : 'star-outline'}
                            size={14}
                            color={starredOnly ? colors.accent : colors.textSecondary}
                        />
                        <Text
                            style={[
                                styles.chipText,
                                { color: starredOnly ? colors.accent : colors.textSecondary },
                            ]}
                        >
                            Starred
                        </Text>
                    </View>
                </Pressable>
                {MOOD_PRESETS.map(preset => {
                    const selected = preset.key === moodPresetKey;
                    return (
                        <Pressable
                            key={preset.key}
                            testID={`mood-filter-${preset.key}`}
                            onPress={() => onMoodPresetChange(preset.key)}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            style={[
                                styles.chip,
                                {
                                    backgroundColor: selected
                                        ? colors.accentLight
                                        : colors.overlays.tag,
                                    borderColor: selected
                                        ? colors.accent
                                        : colors.overlays.tagBorder,
                                },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.chipText,
                                    { color: selected ? colors.accent : colors.textSecondary },
                                ]}
                            >
                                {preset.label}
                            </Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}
