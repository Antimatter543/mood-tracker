import { ThemeColors, useThemeColors } from '@/styles/global';
import { ViewProps, View, StatusBar, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AddEntryButton } from './AddEntryButton';
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
                    padding: 16,
                    flexGrow: 1,
                    // Pad the bottom past the FAB so the last item is reachable
                    // above the floating button + the bottom safe area.
                    paddingBottom: 80 + insetBottom,
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
                        {children}
                    </ScrollView>
                ) : (
                    <View style={styles.fullHeightContent}>{children}</View>
                )}

                {showFab && <AddEntryButton />}
            </View>
        </View>
    );
}
