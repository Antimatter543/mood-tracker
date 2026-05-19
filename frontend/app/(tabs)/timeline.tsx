import { View, StyleSheet } from "react-native";
import { Layout } from "@/components/PageContainer";
import { useThemeColors } from "@/styles/global";
import { DatabaseViewer } from "@/components/DBViewer";
import { useMemo } from "react";

const useStyles = (colors: ReturnType<typeof useThemeColors>) =>
    useMemo(
        () =>
            StyleSheet.create({
                container: {
                    flex: 1,
                    position: 'relative',
                },
                content: {
                    flex: 1,
                    zIndex: 1,
                },
            }),
        [colors]
    );

export default function Timeline() {
    const colors = useThemeColors();
    const styles = useStyles(colors);
    return (
        <Layout useScrollView={false}>
            <View style={styles.container}>
                <View style={styles.content}>
                    <DatabaseViewer />
                </View>
            </View>
        </Layout>
    );
}
