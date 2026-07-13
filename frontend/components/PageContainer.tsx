import { ThemeColors, useThemeColors } from '@/styles/global';
import { ViewProps, View, StatusBar, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddEntryButton } from './AddEntryButton';
import { useMemo, useEffect } from 'react';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    Easing,
} from 'react-native-reanimated';

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
                    padding: 20,
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

    // Subtle entrance animation (fade in + slide up). Applied ONLY to the
    // content-sized Animated.View inside the ScrollView (`useScrollView={true}`
    // branch below).
    //
    // It must NOT wrap the `flex: 1` full-height branch (`useScrollView={false}`).
    // A live `useAnimatedStyle` attached to a `flex: 1` container corrupts that
    // container's layout on Fabric + reanimated 4 once its children re-lay-out
    // after mount: on the Statistics screen the ~8 charts each resolve their async
    // data and re-render over ~3s, and on one of those re-layouts reanimated
    // applies the animated props against a stale measured frame and shoves the
    // whole subtree ~1.6k px off-screen — blanking the tab with NO JS re-render at
    // all. (Verified on-device: the property animated is irrelevant — even an
    // opacity-only animatedStyle blanks it; only removing the animatedStyle from
    // the flex:1 view fixes it. Lighter screens like Timeline share the branch but
    // don't reproduce because their content doesn't repeatedly re-lay-out after
    // mount.) The full-height branch therefore renders statically. Root-caused
    // on-device 2026-07-13 — the Statistics blank-screen P0.
    const opacity = useSharedValue(0);
    const translateY = useSharedValue(20);

    useEffect(() => {
        opacity.value = withTiming(1, {
            duration: 300,
            easing: Easing.out(Easing.cubic),
        });
        translateY.value = withTiming(0, {
            duration: 300,
            easing: Easing.out(Easing.cubic),
        });
    }, [opacity, translateY]);

    const animatedContentStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
        transform: [{ translateY: translateY.value }],
    }));

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
                        <Animated.View style={animatedContentStyle}>
                            {children}
                        </Animated.View>
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
