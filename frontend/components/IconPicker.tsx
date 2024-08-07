import React, { useState } from 'react';
import { View, Text, Modal, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { useThemeColors } from '@/styles/global';
import * as Feather from '@expo/vector-icons/Feather';
import * as MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as FontAwesome6 from '@expo/vector-icons/MaterialCommunityIcons';


// Define the icon category structure
type IconInfo = {
    name: string;
    family: IconFamilyType;
};

type IconCategory = {
    name: string;
    icons: IconInfo[];
};

// Organize icons by category
const ICON_CATEGORIES: IconCategory[] = [
    {
        name: "Emotions & Mental State",
        icons: [
            // Basic emotions
            { name: 'smile', family: 'Feather' },
            { name: 'frown', family: 'Feather' },
            { name: 'meh', family: 'Feather' },
            { name: 'heart', family: 'Feather' },
            { name: 'emoticon-happy-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-sad-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-angry-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-cry-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-confused-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-excited-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-neutral-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoticon-sick-outline', family: 'MaterialCommunityIcons' },
            { name: 'emoji-emotions', family: 'MaterialIcons' },

            // Mental state
            { name: 'brain', family: 'MaterialCommunityIcons' },
            { name: 'brain-freeze', family: 'MaterialCommunityIcons' },
            { name: 'head-sync', family: 'MaterialCommunityIcons' },
            { name: 'thought-bubble-outline', family: 'MaterialCommunityIcons' },
            { name: 'meditation', family: 'MaterialCommunityIcons' },
            { name: 'heart-broken-outline', family: 'MaterialCommunityIcons' },

            // Energy/Motivation
            { name: 'zap', family: 'Feather' },
            { name: 'refresh', family: 'Feather' },
            { name: 'shield', family: 'Feather' },
            { name: 'lightning-bolt', family: 'MaterialCommunityIcons' },
            { name: 'alert-circle', family: 'Feather' },
            { name: 'star', family: 'Feather' },
            { name: 'shopping-outline', family: 'MaterialCommunityIcons' },
        ]
    },
    {
        name: "Physical Activities",
        icons: [
            { name: 'activity', family: 'Feather' },
            { name: 'run', family: 'MaterialCommunityIcons' },
            { name: 'bicycle', family: 'MaterialCommunityIcons' },
            { name: 'swim', family: 'MaterialCommunityIcons' },
            { name: 'weight-lifter', family: 'MaterialCommunityIcons' },
            { name: 'yoga', family: 'MaterialCommunityIcons' },
            { name: 'basketball', family: 'MaterialCommunityIcons' },
            { name: 'soccer', family: 'MaterialCommunityIcons' },
            { name: 'tennis', family: 'MaterialCommunityIcons' },
            { name: 'fitness-center', family: 'MaterialIcons' },
            { name: 'accessibility', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Leisure & Entertainment",
        icons: [
            { name: 'gamepad-variant', family: 'MaterialCommunityIcons' },
            { name: 'music', family: 'Feather' },
            { name: 'music-note', family: 'MaterialCommunityIcons' },
            { name: 'guitar', family: 'MaterialCommunityIcons' },
            { name: 'piano', family: 'MaterialCommunityIcons' },
            { name: 'book', family: 'Feather' },
            { name: 'book-open-outline', family: 'MaterialCommunityIcons' },
            { name: 'book-open-page-variant', family: 'MaterialCommunityIcons' },
            { name: 'movie-open-outline', family: 'MaterialCommunityIcons' },
            { name: 'palette-outline', family: 'MaterialCommunityIcons' },
            { name: 'brush', family: 'MaterialIcons' },
            { name: 'camera', family: 'Feather' },
            { name: 'camera-outline', family: 'MaterialCommunityIcons' },
            { name: 'image', family: 'Feather' },
            { name: 'casino', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Social & Relationships",
        icons: [
            { name: 'users', family: 'Feather' },
            { name: 'user', family: 'Feather' },
            { name: 'account-group-outline', family: 'MaterialCommunityIcons' },
            { name: 'account-heart-outline', family: 'MaterialCommunityIcons' },
            { name: 'account-multiple', family: 'MaterialCommunityIcons' },
            { name: 'account-circle', family: 'MaterialIcons' },
            { name: 'chat-outline', family: 'MaterialCommunityIcons' },
            { name: 'message-text-outline', family: 'MaterialCommunityIcons' },
            { name: 'human-greeting-variant', family: 'MaterialCommunityIcons' },
            { name: 'handshake', family: 'MaterialCommunityIcons' },
            { name: 'party-popper', family: 'MaterialCommunityIcons' },
            { name: 'mail', family: 'Feather' },
            { name: 'phone', family: 'MaterialCommunityIcons' },
            { name: 'child-care', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Health & Wellness",
        icons: [
            { name: 'sleep', family: 'MaterialCommunityIcons' },
            { name: 'sleep-off', family: 'MaterialCommunityIcons' },
            { name: 'power-sleep', family: 'MaterialCommunityIcons' },
            { name: 'fruit-watermelon', family: 'MaterialCommunityIcons' },
            { name: 'hamburger', family: 'MaterialCommunityIcons' },
            { name: 'fastfood', family: 'MaterialIcons' },
            { name: 'coffee', family: 'Feather' },
            { name: 'eye', family: 'Feather' },
            { name: 'thermometer', family: 'Feather' },
        ]
    },
    {
        name: "Work & Productivity",
        icons: [
            { name: 'briefcase', family: 'Feather' },
            { name: 'calendar', family: 'Feather' },
            { name: 'bookmark', family: 'Feather' },
            { name: 'award', family: 'Feather' },
            { name: 'code', family: 'Feather' },
            { name: 'computer', family: 'MaterialIcons' },
            { name: 'alarm', family: 'MaterialIcons' },
            { name: 'lightbulb-outline', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Places & Travel",
        icons: [
            { name: 'home', family: 'Feather' },
            { name: 'home-heart', family: 'MaterialCommunityIcons' },
            { name: 'map', family: 'Feather' },
            { name: 'flight', family: 'MaterialIcons' },
            { name: 'airport-shuttle', family: 'MaterialIcons' },
            { name: 'beach-access', family: 'MaterialIcons' },
            { name: 'deck', family: 'MaterialIcons' },
        ]
    },
    {
        name: "Nature & Environment",
        icons: [
            { name: 'cloud', family: 'Feather' },
            { name: 'sun', family: 'Feather' },
            { name: 'tree', family: 'MaterialCommunityIcons' },
            { name: 'weather-lightning-rainy', family: 'MaterialCommunityIcons' },
            { name: 'umbrella', family: 'Feather' },
            { name: 'eco', family: 'MaterialIcons' },
        ]
    },

];

// Keep the original ICON_FAMILIES for rendering
export const ICON_FAMILIES = {
    Feather: { component: Feather },
    MaterialCommunityIcons: { component: MaterialCommunityIcons },
    MaterialIcons: { component: MaterialIcons },
    FontAwesome6: { component: FontAwesome6 },
    Emoji: { component: null }

};

export type IconFamilyType = keyof typeof ICON_FAMILIES;

type IconPickerProps = {
    visible: boolean;
    onClose: () => void;
    onSelect: (family: string, name: string) => void;
    currentFamily?: string;
    currentIcon?: string;
};

export const IconPicker: React.FC<IconPickerProps> = ({
    visible,
    onClose,
    onSelect,
    currentFamily = 'Feather',
    currentIcon = 'circle'
}) => {
    const colors = useThemeColors();
    const [selectedCategory, setSelectedCategory] = useState(ICON_CATEGORIES[0].name);
    const [searchQuery, setSearchQuery] = useState('');
    const [showEmojiInput, setShowEmojiInput] = useState(false);
    const [customEmoji, setCustomEmoji] = useState('');

    
    const styles = StyleSheet.create({
        modalContainer: {
            flex: 1,
            backgroundColor: colors.background,
        },
        header: {
            flexDirection: 'row',
            padding: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            alignItems: 'center',
            justifyContent: 'space-between',
        },
        title: {
            fontSize: 20,
            fontWeight: 'bold',
            color: colors.text,
        },
        closeButton: {
            padding: 8,
        },
        categorySelector: {
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        categoryScroll: {
            paddingVertical: 12,
            paddingHorizontal: 16,
        },
        categoryScrollContent: {
            flexDirection: 'row',
            gap: 8,
            paddingRight: 16,
        },
        categoryButton: {
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
        },
        categoryButtonActive: {
            backgroundColor: colors.accent,
            borderColor: colors.accent,
        },
        categoryButtonText: {
            color: colors.text,
            fontSize: 14,
        },
        categoryButtonTextActive: {
            color: '#fff',
        },
        categoryLabel: {
            fontSize: 16,
            fontWeight: '600',
            color: colors.text,
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 8,
        },
        iconGrid: {
            flexDirection: 'row',
            flexWrap: 'wrap',
            padding: 16,
            gap: 16,
            justifyContent: 'center',
        },
        iconButton: {
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: colors.overlays.tag,
            justifyContent: 'center',
            alignItems: 'center',
            borderWidth: 1,
            borderColor: colors.overlays.tagBorder,
        },
        iconButtonActive: {
            backgroundColor: colors.accent,
            borderColor: colors.accent,
        },

        searchContainer: {
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
        },
        searchInputContainer: {
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: colors.overlays.tag,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderWidth: 1,
            borderColor: colors.overlays.tagBorder,
        },
        searchIcon: {
            marginRight: 8,
        },
        searchInput: {
            flex: 1,
            fontSize: 16,
            color: colors.text,
            padding: 0,
        },
        clearButton: {
            padding: 4,
        },

                // Emoji input styles
                emojiSection: {
                    padding: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                },
                emojiInputContainer: {
                    marginTop: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                },
                emojiInput: {
                    backgroundColor: colors.overlays.tag,
                    borderRadius: 8,
                    padding: 12,
                    flex: 1,
                    marginRight: 8,
                    fontSize: 24,
                    textAlign: 'center',
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                    color: colors.text,
                },
                emojiSubmitButton: {
                    backgroundColor: colors.accent,
                    paddingVertical: 12,
                    paddingHorizontal: 16,
                    borderRadius: 8,
                },
                emojiSubmitText: {
                    color: '#fff',
                    fontWeight: '600',
                    fontSize: 14,
                },
                emojiToggleButton: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: colors.overlays.tag,
                    borderRadius: 8,
                    padding: 12,
                    gap: 8,
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                },
                emojiToggleText: {
                    color: colors.text,
                    fontSize: 16,
                },
                commonEmojis: {
                    flexDirection: 'row',
                    flexWrap: 'wrap',
                    marginTop: 12,
                    justifyContent: 'center',
                    gap: 8,
                },
                quickEmojiButton: {
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: colors.overlays.tag,
                    borderWidth: 1,
                    borderColor: colors.overlays.tagBorder,
                    justifyContent: 'center',
                    alignItems: 'center',
                },
                quickEmojiText: {
                    fontSize: 22,
                },
        
    });


    // Common emojis for quick selection
    const commonEmojis = ['😊', '😎', '😍', '🤔', '😂', '😭', '😴', '🥳', '🏃', '🍔', '🎮', '📚', '🎵', '💻', '🏠', '❤️', '🌱', '🌞', '🧹'];

    // Function to filter icons based on search query
    const getFilteredCategories = () => {
        if (!searchQuery.trim()) {
            return ICON_CATEGORIES;
        }

        const query = searchQuery.toLowerCase();
        return ICON_CATEGORIES.map(category => ({
            ...category,
            icons: category.icons.filter(icon =>
                icon.name.toLowerCase().includes(query)
            )
        })).filter(category => category.icons.length > 0);
    };

    const renderIcon = (iconInfo: IconInfo) => {
        const IconComponent = ICON_FAMILIES[iconInfo.family].component;
        const isSelected = currentFamily === iconInfo.family && currentIcon === iconInfo.name;

        return (
            <Pressable
                key={`${iconInfo.family}-${iconInfo.name}`}
                style={[
                    styles.iconButton,
                    isSelected && styles.iconButtonActive
                ]}
                onPress={() => {
                    onSelect(iconInfo.family, iconInfo.name);
                    onClose();
                }}
            >
                <IconComponent.default
                    name={iconInfo.name}
                    size={24}
                    color={isSelected ? '#fff' : colors.text}
                />
            </Pressable>
        );
    };

    const handleSubmitEmoji = () => {
        if (customEmoji.trim()) {
            onSelect('Emoji', customEmoji);
            onClose();
        }
    };

    const handleQuickEmojiSelect = (emoji: string) => {
        setCustomEmoji(emoji);
    };
    return (
        <Modal
            visible={visible}
            animationType="slide"
            onRequestClose={onClose}
        >
            <View style={styles.modalContainer}>
                <View style={styles.header}>
                    <Text style={styles.title}>Select Icon</Text>
                    <Pressable style={styles.closeButton} onPress={onClose}>
                        <Feather.default name="x" size={24} color={colors.text} />
                    </Pressable>
                </View>



                {/* Emoji Input Section */}
                <View style={styles.emojiSection}>
                    <Pressable 
                        style={styles.emojiToggleButton}
                        onPress={() => setShowEmojiInput(!showEmojiInput)}
                    >
                        <Text style={styles.emojiToggleText}>
                            {showEmojiInput ? 'Hide Emoji Input' : 'Use Custom Emoji'}
                        </Text>
                        <MaterialIcons.default 
                            name={showEmojiInput ? 'expand-less' : 'expand-more'} 
                            size={24} 
                            color={colors.text} 
                        />
                    </Pressable>

                    {showEmojiInput && (
                        <>
                            <View style={styles.emojiInputContainer}>
                                <TextInput
                                    style={styles.emojiInput}
                                    value={customEmoji}
                                    onChangeText={setCustomEmoji}
                                    placeholder="🙂"
                                    placeholderTextColor={colors.textSecondary}
                                    maxLength={2} // Limit to 1-2 emoji characters
                                />
                                <Pressable 
                                    style={styles.emojiSubmitButton}
                                    onPress={handleSubmitEmoji}
                                >
                                    <Text style={styles.emojiSubmitText}>Use Emoji</Text>
                                </Pressable>
                            </View>
                            
                            <View style={styles.commonEmojis}>
                                {commonEmojis.map(emoji => (
                                    <Pressable
                                        key={emoji}
                                        style={styles.quickEmojiButton}
                                        onPress={() => handleQuickEmojiSelect(emoji)}
                                    >
                                        <Text style={styles.quickEmojiText}>{emoji}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        </>
                    )}
                </View>

                {/* Search container */}
                <View style={styles.searchContainer}>
                    <View style={styles.searchInputContainer}>
                        <Feather.default name="search" size={20} color={colors.textSecondary} style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search icons..."
                            placeholderTextColor={colors.textSecondary}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                        {searchQuery ? (
                            <Pressable onPress={() => setSearchQuery('')} style={styles.clearButton}>
                                <Feather.default name="x-circle" size={16} color={colors.textSecondary} />
                            </Pressable>
                        ) : null}
                    </View>
                </View>

                <View style={styles.categorySelector}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.categoryScroll}
                        contentContainerStyle={styles.categoryScrollContent}
                    >
                        {ICON_CATEGORIES.map(category => (
                            <Pressable
                                key={category.name}
                                style={[
                                    styles.categoryButton,
                                    selectedCategory === category.name && styles.categoryButtonActive
                                ]}
                                onPress={() => setSelectedCategory(category.name)}
                            >
                                <Text style={[
                                    styles.categoryButtonText,
                                    selectedCategory === category.name && styles.categoryButtonTextActive
                                ]}>
                                    {category.name}
                                </Text>
                            </Pressable>
                        ))}
                    </ScrollView>
                </View>

                <ScrollView>
                    {searchQuery ? (
                        // If searching, show all matches across categories
                        getFilteredCategories().map(category => (
                            <View key={category.name}>
                                <Text style={styles.categoryLabel}>{category.name}</Text>
                                <View style={styles.iconGrid}>
                                    {category.icons.map(iconInfo => renderIcon(iconInfo))}
                                </View>
                            </View>
                        ))
                    ) : (
                        // If not searching, show only the selected category
                        ICON_CATEGORIES.map(category => (
                            selectedCategory === category.name && (
                                <View key={category.name}>
                                    <Text style={styles.categoryLabel}>{category.name}</Text>
                                    <View style={styles.iconGrid}>
                                        {category.icons.map(iconInfo => renderIcon(iconInfo))}
                                    </View>
                                </View>
                            )
                        ))
                    )}

                    {searchQuery && getFilteredCategories().length === 0 && (
                        <View style={{ padding: 20, alignItems: 'center' }}>
                            <Text style={{ color: colors.textSecondary }}>No icons found for "{searchQuery}"</Text>
                        </View>
                    )}
                </ScrollView>
            </View>
        </Modal>
    );
};