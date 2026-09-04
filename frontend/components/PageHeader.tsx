import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ViewProps } from 'react-native';
import { ThemeColors, useThemeColors } from '@/styles/global';
import { LAYOUT_CONTENT_PADDING } from '@/styles/layout';

/**
 * The ONE page-title convention.
 *
 * Every tab screen opens with this: a glyph + the page title (+ an optional
 * one-line subtitle), then straight into the content. The bottom tab bar
 * already tells the user which page they're on, so the navigator's own header
 * bar is switched OFF for every tab (`headerShown: false` in the shared
 * `screenOptions` of `app/(tabs)/_layout.tsx`) — that navigator bar is what
 * used to put a second, differently-styled title strip above Home / Statistics
 * / Timeline / Insights while Settings drew its own in-page title.
 *
 * Because the navigator header is gone, the top safe-area inset is the page's
 * responsibility: `components/PageContainer.tsx` (`Layout`) applies it, so
 * always render this INSIDE a `<Layout>`.
 *
 * Drift guard: `__tests__/pageHeaderUniformity.test.ts` fails the build if a
 * tab screen stops using this component or if a screen re-enables the
 * navigator header.
 */

/** Size every page-header glyph renders at. Owned here, never by the screen. */
export const PAGE_HEADER_ICON_SIZE = 26;

/**
 * `style` for screens that render outside `Layout`'s ScrollView
 * (`useScrollView={false}` — Statistics, Timeline) and so receive none of its
 * content padding. Derived from `LAYOUT_CONTENT_PADDING` so the title lines up
 * with the scrolling screens' instead of being eyeballed per screen.
 *
 * BOTH axes matter. The ScrollView branch pads its content on every side, so a
 * full-height screen that only restores the horizontal gutter draws its title
 * `LAYOUT_CONTENT_PADDING` px HIGHER than Home / Insights (the 2026-09-04
 * "Timeline sits higher than Insights" drift). The top padding here keeps every
 * page title on one vertical line; `__tests__/pageHeaderUniformity.test.ts`
 * pins it.
 */
export const pageHeaderFullHeightInset = StyleSheet.create({
    inset: {
        paddingHorizontal: LAYOUT_CONTENT_PADDING,
        paddingTop: LAYOUT_CONTENT_PADDING,
    },
}).inset;

type PageHeaderProps = {
    /** e.g. "Settings", "Timeline". Sentence case, not uppercase. */
    title: string;
    /** Optional one-liner under the title, e.g. "What your entries say about you". */
    subtitle?: string;
    /**
     * Render prop for the glyph. It's a function rather than a ReactNode so the
     * size and colour stay owned by this component — a screen only chooses
     * WHICH glyph (and from which icon family), never how big or what colour.
     */
    icon?: (props: { size: number; color: string }) => React.ReactNode;
    /**
     * Horizontal padding is NOT baked in: screens that render inside `Layout`'s
     * ScrollView already sit in its content padding. Full-height screens
     * (`useScrollView={false}`) pass their own inset here so the title lines up
     * with the scrolling screens.
     */
    style?: ViewProps['style'];
    testID?: string;
};

const useStyles = (colors: ThemeColors) =>
    useMemo(
        () =>
            StyleSheet.create({
                container: {
                    marginBottom: 18,
                },
                row: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                },
                title: {
                    fontSize: 28,
                    fontWeight: '800',
                    color: colors.text,
                    letterSpacing: -0.5,
                    // Let a long / large-font-scale title wrap instead of being
                    // pushed off-screen by the glyph.
                    flexShrink: 1,
                },
                subtitle: {
                    fontSize: 15,
                    color: colors.textSecondary,
                    marginTop: 4,
                },
            }),
        [colors]
    );

export function PageHeader({
    title,
    subtitle,
    icon,
    style,
    testID = 'page-header',
}: PageHeaderProps) {
    const colors = useThemeColors();
    const styles = useStyles(colors);

    return (
        <View style={[styles.container, style]} testID={testID}>
            <View style={styles.row}>
                {icon?.({ size: PAGE_HEADER_ICON_SIZE, color: colors.text })}
                <Text
                    style={styles.title}
                    testID="page-header-title"
                    accessibilityRole="header"
                >
                    {title}
                </Text>
            </View>
            {subtitle ? (
                <Text style={styles.subtitle} testID="page-header-subtitle">
                    {subtitle}
                </Text>
            ) : null}
        </View>
    );
}

export default PageHeader;
