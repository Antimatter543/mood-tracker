import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';
import { useThemeColors } from '@/styles/global';

type InfoBubbleProps = {
  text: string;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
};

const InfoBubble = ({ text, position = 'top-right' }: InfoBubbleProps) => {
  const colors = useThemeColors();
  const [showInfo, setShowInfo] = useState(false);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      position: 'absolute',
      zIndex: 1000,
    },
    button: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.overlays.tag,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.overlays.tagBorder,
    },
    buttonPressed: {
      opacity: 0.7,
    },
    popup: {
      position: 'absolute',
      width: 200,
      backgroundColor: colors.cardBackground,
      borderRadius: 8,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
    },
    text: {
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
  }), [colors]);

  // Helper function to get container position styles
  const getPositionStyle = (position: string) => {
    const distance = 4; // they had 12 by default
    switch (position) {
      case 'top-right':
        return { top: distance, right: distance };
      case 'top-left':
        return { top: distance, left: distance };
      case 'bottom-right':
        return { bottom: distance, right: distance };
      case 'bottom-left':
        return { bottom: distance, left: distance };
      default:
        return { top: distance, right: distance };
    }
  };

  // Helper function to get popup position styles
  const getPopupStyle = (position: string) => {
    switch (position) {
      case 'top-right':
        return { right: 0, top: 36 };
      case 'top-left':
        return { left: 0, top: 36 };
      case 'bottom-right':
        return { right: 0, bottom: 36 };
      case 'bottom-left':
        return { left: 0, bottom: 36 };
      default:
        return { right: 0, top: 36 };
    }
  };

  return (
    <View style={[
      styles.container,
      getPositionStyle(position),
    ]}>
      {/* Info button */}
      <Pressable 
        onPress={() => setShowInfo(!showInfo)}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.buttonPressed
        ]}
      >
        {showInfo ? (
            <Ionicons name="close" color={colors.text} size={18} />

        ) : (
            <Feather name="help-circle" size={18} color={colors.text} />  // regular
        //   <HelpCircle size={18} color={colors.text} />
        )}
      </Pressable>

      {/* Popup */}
      {showInfo && (
        <View style={[
          styles.popup,
          getPopupStyle(position)
        ]}>
          <Text style={styles.text}>{text}</Text>
        </View>
      )}
    </View>
  );
};

export default InfoBubble;