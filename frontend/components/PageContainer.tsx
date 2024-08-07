import { ThemeColors, useThemeColors } from "@/styles/global";
import { ViewProps, View, StatusBar, ScrollView, StyleSheet } from "react-native";
import { AddEntryButton } from "./AddEntryButton";
import { useMemo } from "react";
import { useSettings } from "@/context/SettingsContext";

type LayoutProps = {
    children: React.ReactNode;
    contentStyle?: ViewProps['style'];
    useScrollView?: boolean;  // New prop
} & ViewProps;

const useThemedStyles = (colors: ThemeColors) => {
    return useMemo(() => StyleSheet.create({
        container: {
            flex: 1,
            backgroundColor: colors.background,
        },
        contentContainer: {
            flex: 1,
            backgroundColor: colors.background,
            position: 'relative',
        },
        scrollContent: {
            padding: 16,
            flexGrow: 1,
            paddingBottom: 80,
        },
        fullHeightContent: {
            flex: 1,
        }
    }), [colors]);
};

export function Layout({ children, style, contentStyle, useScrollView = true, ...props }: LayoutProps) {
    const colors = useThemeColors();
    const { settings } = useSettings();
    const styles = useThemedStyles(colors);
    
    const themeMode = settings.theme_mode;
    

    return (
        <View style={[styles.container, style]} {...props}>
            <StatusBar 
                barStyle={themeMode === 'light' ? 'dark-content' : 'light-content'} 
                backgroundColor={colors.secondaryBackground} 
            />

            <View style={[styles.contentContainer, contentStyle]}>
                {useScrollView ? ( // Make scrollview conditional
                    <ScrollView
                        contentContainerStyle={[
                            styles.scrollContent,
                            contentStyle,   
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        {children}
                    </ScrollView>
                ) : ( // Direct children when ScrollView not needed (for timeline goated)
                    <View style={styles.fullHeightContent}>
                        {children}
                    </View>
                )}

                <AddEntryButton />
            </View>
        </View>
    );
}