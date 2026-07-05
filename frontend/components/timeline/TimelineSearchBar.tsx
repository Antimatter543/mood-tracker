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
import { ThemeColors } from '@/styles/global';
import { MOOD_PRESETS, MoodPresetKey } from './entryFilter';

type TimelineSearchBarProps = {
    query: string;
    onQueryChange: (t: string) => void;
    moodPresetKey: MoodPresetKey;
    onMoodPresetChange: (k: MoodPresetKey) => void;
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
                    paddingHorizontal: 16,
                    paddingTop: 8,
                    paddingBottom: 12,
                    backgroundColor: colors.background,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: colors.border,
                },
                searchPill: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: 44,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: colors.secondaryBackground,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
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
    colors,
}: TimelineSearchBarProps) {
    const styles = useStyles(colors);

    return (
        <View style={styles.container}>
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

            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipScrollContent}
                keyboardShouldPersistTaps="handled"
            >
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
