import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Layout } from "@/components/PageContainer";
import ActivityImpactChart from "@/components/visualisations/ActivityImpactChart";
import CustomHeatmap from "@/components/visualisations/CustomHeatMap";
import DailyMoodChart from "@/components/visualisations/DailyMoodBar";
import RecoveryAnalysis from "@/components/visualisations/RecoveryPatterns";
import MoodHistogram from "@/components/visualisations/Scatterplot";
import { BasicLineChart } from "@/components/visualisations/WeeklyMoodChart";
import TimeframeSelector from "@/components/TimeframeSelector";
import { TimeframeProvider, useTimeframe } from "@/context/TimeframeContext";
import { useThemeColors } from "@/styles/global";

const StatisticsContent = () => {
  const { timeframe, setTimeframe, timeframeDescription } = useTimeframe();
  const colors = useThemeColors();
  
  const styles = StyleSheet.create({
    container: {
      flex: 1,
    },
    scrollView: {
      flex: 1,
    },
    stickyHeader: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.background,
      paddingTop: 12,
      paddingBottom: 12,
      zIndex: 1000,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 6,
      alignItems: 'center',
    },
    description: {
      color: colors.textSecondary,
      fontSize: 14,
      marginTop: 4,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 120, // Padding to account for the sticky header
      paddingBottom: 32,
    },
    chartsContainer: {
      gap: 16, // Add space between charts
    }
  });

  return (
    <View style={styles.container}>
      {/* Sticky Header positioned above the ScrollView */}
      <View style={styles.stickyHeader}>
        <TimeframeSelector 
          selectedTimeframe={timeframe} 
          onTimeframeChange={setTimeframe} 
        />
        <Text style={styles.description}>{timeframeDescription}</Text>
      </View>
      
      {/* ScrollView containing all charts */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={true}
      >
        <View style={styles.chartsContainer}>
          <BasicLineChart />
          <DailyMoodChart />
          <CustomHeatmap />
          <ActivityImpactChart />
          <RecoveryAnalysis />
          <MoodHistogram />
        </View>
      </ScrollView>
    </View>
  );
};

export default function Stats() {
  return (
    <TimeframeProvider>
      <Layout useScrollView={false}>
        <StatisticsContent />
      </Layout>
    </TimeframeProvider>
  );
}