import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useThemeColors } from '@/styles/global';

// Background UI Component
const BackgroundUI = () => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
  <View style={styles.backgroundContainer}>
    {/* Header Card */}
    <View style={styles.card}>
      <Text style={styles.headerText}>Your Mood Circle</Text>
    </View>

    {/* Privacy Card */}
    <View style={styles.card}>
      <Text style={styles.labelText}>Privacy Settings</Text>
      <View style={styles.settingsPill}>
        <Text style={styles.pillText}>Sharing: Friends Only</Text>
      </View>
    </View>

    {/* Friend Cards */}
    <View style={styles.card}>
      <View style={styles.friendHeader}>
        <Text style={styles.friendName}>Peaceful Penguin</Text>
        <Text style={[styles.moodScore, { color: '#4CAF50' }]}>8.5</Text>
      </View>
      <View style={styles.trendLine}>
        <View style={[styles.line, { backgroundColor: '#4CAF50' }]} />
      </View>
      <View style={styles.actionRow}>
        <Pressable style={styles.actionButton}>
          <Text style={styles.buttonText}>👋 Hi!</Text>
        </Pressable>
        <Pressable style={styles.actionButton}>
          <Text style={styles.buttonText}>💝 Care</Text>
        </Pressable>
      </View>
    </View>

    <View style={styles.card}>
      <View style={styles.friendHeader}>
        <Text style={styles.friendName}>Thoughtful Cloud</Text>
        <Text style={[styles.moodScore, { color: '#FF9800' }]}>4.2</Text>
      </View>
      <View style={styles.trendLine}>
        <View style={[styles.line, { backgroundColor: '#FF9800' }]} />
      </View>
      <View style={styles.actionRow}>
        <Pressable style={styles.actionButton}>
          <Text style={styles.buttonText}>🤗 Hug</Text>
        </Pressable>
        <Pressable style={styles.actionButton}>
          <Text style={styles.buttonText}>💌 DM</Text>
        </Pressable>
      </View>
    </View>

    {/* Find Friends Button */}
    <Pressable style={styles.findFriendsButton}>
      <Text style={styles.findFriendsText}>Find Friends</Text>
    </Pressable>
  </View>
);
}


// Overlay Component
const ComingSoonOverlay = () => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
  
    return (
      <View style={styles.overlay}>
        <View style={styles.overlayContent}>
        <MaterialIcons name="construction" size={48} color={colors.text} style={styles.icon} />
          <Text style={styles.overlayTitle}>Coming Soon!</Text>
          <Text style={styles.overlayDescription}>
            We're (well, I am) working on exciting social features so you connect with friends and share your journey! {'\n'}{'\n'}
            If you've liked this app and its concept, please leave some reviews, or send feedback to me! All is appreciated and it motivates me! {'\u003C'}3 {'\n'}{'\n'}
            Here's what I'm planning to build with your support:
          </Text>
          <View style={styles.featureList}>
            <Text style={styles.feature}>• Anonymous Mood Circles</Text>
            <Text style={styles.feature}>• Friends Support System</Text>
            <Text style={styles.feature}>• Community Challenges</Text>
          </View>
        </View>
      </View>
    );
  };

  const useThemedStyles = (colors: any) => {
    return useMemo(() => StyleSheet.create({
      container: {
        flex: 1,
        backgroundColor: colors.background,
      },
      backgroundContainer: {
        padding: 16,
        gap: 12,
      },
      card: {
        backgroundColor: colors.overlays.tag,
        borderRadius: 12,
        padding: 16,
        borderWidth: 1,
        borderColor: colors.overlays.tagBorder,
      },
      headerText: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.text,
      },
      labelText: {
        fontSize: 16,
        color: colors.textSecondary,
        marginBottom: 8,
      },
      settingsPill: {
        backgroundColor: colors.overlays.tag,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 16,
        alignSelf: 'flex-start',
      },
      pillText: {
        color: colors.text,
        fontSize: 14,
      },
      friendHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
      },
      friendName: {
        fontSize: 18,
        color: colors.text,
      },
      moodScore: {
        fontSize: 18,
        fontWeight: 'bold',
      },
      trendLine: {
        height: 2,
        backgroundColor: colors.overlays.tag,
        marginBottom: 12,
      },
      line: {
        height: '100%',
        width: '60%',
        borderRadius: 1,
      },
      actionRow: {
        flexDirection: 'row',
        gap: 8,
      },
      actionButton: {
        backgroundColor: colors.overlays.tag,
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 16,
      },
      buttonText: {
        color: colors.text,
        fontSize: 14,
      },
      findFriendsButton: {
        backgroundColor: colors.overlays.tag,
        padding: 16,
        borderRadius: 12,
        alignItems: 'center',
      },
      findFriendsText: {
        color: colors.text,
        fontSize: 16,
      },
  
      // Overlay styles
overlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: `${colors.background}E6`, // E6 is ~90% opacity in hex
  justifyContent: 'center',
  alignItems: 'center',
  padding: 20,
},
overlayContent: {
  backgroundColor: colors.overlays.tag, // This one can stay semi-transparent
  padding: 24,
  borderRadius: 16,
  alignItems: 'center',
  maxWidth: 400,
  borderWidth: 1,
  borderColor: colors.overlays.tagBorder,
},
      icon: {
        marginBottom: 16,
        opacity: 0.8,
      },
      overlayTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: colors.text,
        marginBottom: 12,
      },
      overlayDescription: {
        fontSize: 16,
        color: colors.textSecondary,
        textAlign: 'center',
        marginBottom: 24,
      },
      featureList: {
        alignSelf: 'stretch',
        paddingLeft: 20,
      },
      feature: {
        fontSize: 16,
        color: colors.text,
        marginBottom: 8,
      },
    }), [colors]);
  };
  
  // Main Component
  export default function Social() {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
  
    return (
      <View style={styles.container}>
        <BackgroundUI />
        <ComingSoonOverlay />
      </View>
    );
  }