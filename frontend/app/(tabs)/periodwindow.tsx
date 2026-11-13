import { Card } from '@/components/Card';
import { Layout } from '@/components/PageContainer';
import PageHeader, { pageHeaderFullHeightInset } from '@/components/PageHeader';
import PeriodNavigator from '@/components/PeriodNavigator';
import PeriodSwipe from '@/components/PeriodSwipe';
import TimeframeSelector from '@/components/TimeframeSelector';
import { MONTHLY_DAILY_AVERAGES } from '@/components/visualisations/queries';
import { monthlyOverview } from '@/components/visualisations/transforms/homeSummary';
import { useTimeframe } from '@/context/TimeframeContext';
import { useDataRefresh } from '@/hooks/useDataRefresh';
import { useThemeColors } from '@/styles/global';
import { LAYOUT_CONTENT_PADDING, LAYOUT_FAB_CLEARANCE } from '@/styles/layout';
import { Ionicons } from '@expo/vector-icons';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MonthlyOverviewCard } from '.';

// See components/ScreenErrorFallback.tsx.
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorFallback';

export default function PeriodWindowScreen() {
    const { periodLabel, periodWindow, timeframe, setTimeframe, isCustom } = useTimeframe();
    const colors = useThemeColors();
    const db = useSQLiteContext();
    const [overviewStats, setOverviewStats] = useState<{
        average: number | null;
        totalEntries: number;
        bestDay: string;
    }>({
        average: null,
        totalEntries: 0,
        bestDay: ''
    });

    const fetchData = useCallback(async () => {
            try {
                // Fetch overview rows for the selected period
                const { start, end } = periodWindow;
                const [ monthRows, ] = await Promise.all([
                    db.getAllAsync<{ date: string; mood: number }>(
                        MONTHLY_DAILY_AVERAGES,
                        [start, end]
                    ),
                ]);
                setOverviewStats(monthlyOverview(monthRows));
            } catch (error) {
                console.error('Error fetching overview data:', error);
            }
        }, [db, periodWindow]);
    useDataRefresh(fetchData, [db, periodWindow]);

    const styles = useMemo(() =>
        StyleSheet.create({
            container: {
                flex: 1,
            },
            scrollView: {
                flex: 1,
            },
            cardTitle: {
                fontSize: 18,
                fontWeight: '600',
                color: colors.text,
                marginBottom: 16,
            },
            card: {
            },
            selector: {
            },
            contentContainer: {
                flex: 1,
            },
            content: {
                paddingHorizontal: LAYOUT_CONTENT_PADDING,
                paddingTop: 12,
                paddingBottom: LAYOUT_FAB_CLEARANCE,
                flexGrow: 1,
            },
        }
    ), [colors]);

    return (
        <Layout useScrollView={false}>
            <PageHeader
                style={pageHeaderFullHeightInset}
                title='Timeframe'
                subtitle="All data is shown for the period selected here"
                icon={p => <Ionicons name='calendar-outline' {...p} />}
            />

            <View style={styles.container}>
                <PeriodSwipe
                    style={styles.scrollView}
                    contentContainerStyle={styles.contentContainer}
                    contentStyle={styles.content}
                >
                    <Card accentTop>
                        <Text style={styles.cardTitle}>Select timeframe</Text>
                        <View style={styles.card}>
                            <TimeframeSelector
                                selectedTimeframe={isCustom ? null : timeframe}
                                onTimeframeChange={setTimeframe}
                            />

                            <PeriodNavigator />
                        </View>                            
                    </Card>

                    <MonthlyOverviewCard stats={overviewStats} title={`Summary for ${periodLabel}`} />
                </PeriodSwipe>        
            </View>
        </Layout>
    );
}