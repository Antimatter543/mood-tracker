import { View, StyleSheet } from "react-native";
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Layout } from "@/components/PageContainer";
import { PageHeader, pageHeaderFullHeightInset } from "@/components/PageHeader";
import { DatabaseViewer } from "@/components/DBViewer";

// Static — nothing here is themed (the previous `useStyles(colors)` hook took
// `colors` and never read it).
const styles = StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative',
    },
    content: {
        flex: 1,
        zIndex: 1,
    },
});

// expo-router screen-level error boundary: a render throw in Timeline shows a
// recoverable "Try again" fallback instead of white-screening until restart.
// See components/ScreenErrorFallback.tsx.
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorFallback';

export default function Timeline() {
    return (
        <Layout useScrollView={false}>
            {/* Title first, then straight into the content — the search row +
                bin button (DatabaseViewer's own pinned TimelineSearchBar) sit
                directly under it, where the navigator's header bar used to be. */}
            <PageHeader
                title="Timeline"
                style={pageHeaderFullHeightInset}
                icon={p => <MaterialCommunityIcons name="timeline-text-outline" {...p} />}
            />
            <View style={styles.container}>
                <View style={styles.content}>
                    <DatabaseViewer />
                </View>
            </View>
        </Layout>
    );
}
