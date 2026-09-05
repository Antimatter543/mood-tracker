import { ThemeColors, useThemeColors } from '@/styles/global';
import { ViewProps, View, StatusBar, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddEntryButton } from './AddEntryButton';
import { LAYOUT_CONTENT_PADDING } from '@/styles/layout';
import { useMemo } from 'react';

type LayoutProps = {
    children: React.ReactNode;
    contentStyle?: ViewProps['style'];
    /** When false, children render full-height without a ScrollView wrapper. */
    useScrollView?: boolean;
    /** Hide the FAB on pages where it doesn't make sense (e.g. settings sub-screens). */
    showFab?: boolean;
} & ViewProps;

const useThemedStyles = (colors: ThemeColors, insetTop: number, insetBottom: number) => {
    return useMemo(
        () =>
            StyleSheet.create({
                container: {
                    flex: 1,
                    backgroundColor: colors.background,
                    // Respect the device's top inset (notch / status bar) so content
                    // doesn't slide under it. We add a small extra breathing room
                    // when there's no inset (e.g. Android landscape) so the page
                    // never feels glued to the top edge.
                    paddingTop: insetTop || 8,
                },
                contentContainer: {
                    flex: 1,
                    backgroundColor: colors.background,
                    position: 'relative',
                },
                scrollContent: {
                    padding: LAYOUT_CONTENT_PADDING,
                    flexGrow: 1,
                    // Pad the bottom past the FAB so the last item scrolls fully
                    // into view above the floating button. The FAB floats at
                    // (FAB_BOTTOM_GAP + insetBottom) and is ~56px tall, so this
                    // 100 + insetBottom clearance tracks the FAB as it rises with
                    // the bottom safe-area inset. (The tab-bar height itself is
                    // already excluded from the scene by react-navigation, so we
                    // only clear the FAB here.)
                    paddingBottom: 100 + insetBottom,
                },
                fullHeightContent: {
                    flex: 1,
                },
            }),
        [colors, insetTop, insetBottom]
    );
};

export function Layout({
    children,
    style,
    contentStyle,
    useScrollView = true,
    showFab = true,
    ...props
}: LayoutProps) {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const styles = useThemedStyles(colors, insets.top, insets.bottom);

    // NO entrance animation. `Layout` used to fade+slide its content in through a
    // reanimated `useAnimatedStyle`, and that live animated style is the app's
    // recurring blank-screen mechanism on Fabric + reanimated 4: once the wrapped
    // children re-lay-out after mount, reanimated applies the animated props
    // against a stale measured frame and shoves the whole subtree off-screen,
    // blanking the page with NO JS re-render, no error, and no recovery short of
    // a process restart (a tab switch re-renders the screen but the native views
    // stay displaced). Verified on-device that the animated PROPERTY is
    // irrelevant: an opacity-only animatedStyle blanked it too.
    //
    // This was root-caused on Statistics on 2026-07-13 and fixed THERE ONLY, by
    // removing the animatedStyle from the `useScrollView={false}` branch, on the
    // theory that `flex: 1` was the ingredient. That reading was too narrow. The
    // ingredient is a live animatedStyle wrapping children that re-lay-out
    // asynchronously after mount, and the scrolling branch has exactly that on
    // Home (its cards, chart, and ActivityExplorer each resolve their own async
    // reads and re-lay-out again on every post-write refresh). Home blanked the
    // same way after submitting an entry: everything inside this wrapper vanished
    // while the FAB and tab bar (the only Home chrome rendered OUTSIDE it)
    // survived, which is exactly this wrapper's boundary. Both branches are now
    // static. See __tests__/layoutFullHeightNoTransform.test.tsx.
    return (
        <View style={[styles.container, style]} {...props}>
            <StatusBar
                barStyle={colors.isDark ? 'light-content' : 'dark-content'}
                backgroundColor={colors.secondaryBackground}
            />

            <View style={[styles.contentContainer, contentStyle]}>
                {useScrollView ? (
                    <ScrollView
                        contentContainerStyle={[styles.scrollContent, contentStyle]}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Plain, unanimated wrapper, see the entrance-animation
                            note above for why nothing here may carry a live
                            reanimated style. */}
                        <View>{children}</View>
                    </ScrollView>
                ) : (
                    // Full-height content renders statically — see the entrance-
                    // animation note above for why a reanimated animatedStyle here
                    // blanks heavy screens (the Statistics P0).
                    <View style={styles.fullHeightContent}>
                        {children}
                    </View>
                )}

                {showFab && <AddEntryButton />}
            </View>
        </View>
    );
}
