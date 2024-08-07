import { Text, View, StyleSheet, Pressable } from "react-native";
import { Layout } from "@/components/PageContainer";
import { LineChart } from "react-native-chart-kit";
import { useThemeColors } from "@/styles/global";
import { MONTHLY_MOOD_AVERAGES, WEEKLY_MOOD_AVERAGES_NULLED, WEEKLY_MOOD_POINTS } from "@/components/visualisations/queries";
import { SQLiteDatabase, useSQLiteContext } from "expo-sqlite";
import { interpolateData, CHART_PADDING, SCREEN_WIDTH } from "@/components/visualisations/chartUtils";
import { DatabaseViewer } from "@/components/DBViewer";
import { useMemo } from "react";

function TestButtons({db}: {db: SQLiteDatabase}) {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    // Add function to run queries
    const runQuery = async (query: string) => {
        try {
            let results;
            if (query === MONTHLY_MOOD_AVERAGES) {
                // For monthly averages, we need to provide date parameters
                const endDate = new Date().toISOString();
                const startDate = new Date();
                startDate.setMonth(startDate.getMonth() - 1);
                results = await db.getAllAsync(query, [startDate.toISOString(), endDate]);
            } else {
                results = await db.getAllAsync(query);
            }
            console.log('Query Results:', results);
        } catch (error) {
            console.error('Error running query:', error);
        }
    };

    return (
        <View style={styles.buttonContainer}>
            <Pressable
                style={styles.button}
                onPress={() => runQuery(WEEKLY_MOOD_AVERAGES_NULLED)}
            >
                <Text style={styles.buttonText}>Test Weekly Averages with Nulls!</Text>
            </Pressable>

            <Pressable
                style={styles.button}
                onPress={() => runQuery(WEEKLY_MOOD_POINTS)}
            >
                <Text style={styles.buttonText}>Test Weekly Points</Text>
            </Pressable>

            <Pressable
                style={styles.button}
                onPress={() => runQuery(MONTHLY_MOOD_AVERAGES)}
            >
                <Text style={styles.buttonText}>Test Monthly Averages</Text>
            </Pressable>
        </View>
    )
}

function RandomShit() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const chartWidth = SCREEN_WIDTH - (CHART_PADDING + 32);
    const db = useSQLiteContext();

    const { data: interpolatedData, nullIndices } = interpolateData([50, null, 40, null, 26]);
    console.log("interp data", interpolatedData);

    const data = {
        labels: ["January", "February", "March", "April", "May", "June"],
        datasets: [
            {
                data: [20, 70, 28, 80, 45, 43],
                withDots: false
            },
            {
                data: interpolatedData, // Now this is guaranteed to be number[]
                withDots: true
            }
        ]
    };

    return (
        <View style={styles.cardContainer}>
            {/* Add query test buttons */}
            <TestButtons db={db}/>

            <Text style={styles.text}>Bezier Line Chart</Text>
            <LineChart
                data={data}
                width={chartWidth}
                height={220}
                yAxisLabel="$"
                yAxisSuffix="k"
                yAxisInterval={1}
                getDotColor={(dataPoint, index) => {
                    if (nullIndices.includes(index)) {
                        return '#FF0000';
                    }
                    return colors.accent;
                }}
                chartConfig={{
                    backgroundColor: colors.cardBackground,
                    backgroundGradientFrom: colors.cardBackground,
                    backgroundGradientTo: colors.cardBackground,
                    color: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                    labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
                    style: {
                        borderRadius: 16
                    },
                    propsForDots: {
                        r: "6",
                        strokeWidth: "2",
                        stroke: colors.accent
                    }
                }}
                bezier
                style={styles.chart}
            />
        </View>
    );
}

const useThemedStyles = (colors: any) => {
    return useMemo(() => StyleSheet.create({
        container: {
            marginBottom: 24,
            backgroundColor: colors.overlays.tag,
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border,
        },
        title: {
            fontSize: 18,
            fontWeight: '600',
            marginBottom: 16,
            color: colors.text,
        },
        text: {
            color: colors.text,
        },
        cardContainer: {
            paddingHorizontal: 16,
        },
        chart: {
            marginVertical: 8,
            borderRadius: 16,
        },
        buttonContainer: {
            flexDirection: 'column',
            gap: 8,
            marginBottom: 16,
        },
        button: {
            backgroundColor: colors.overlays.tag,
            padding: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.overlays.tagBorder,
        },
        buttonText: {
            color: colors.text,
            textAlign: 'center',
        }
    }), [colors]);
};

const useStyles = (colors: any) => StyleSheet.create({
    container: {
        flex: 1,
        position: 'relative', // Ensure proper stacking context
    },
    content: {
        flex: 1,
        zIndex: 1, // Lower than the button
    }
});

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