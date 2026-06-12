import React, { useState } from 'react';
import {
    View,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Dimensions,
    FlatList,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { EntryPhoto } from '../types';
import { ThemeColors } from '@/styles/global';
import { OverlayModal } from '../OverlayModal';
import { photoLayoutFor } from './photoLayout';

const { width: VIEWER_WIDTH, height: VIEWER_HEIGHT } = Dimensions.get('window');

const viewerStyles = StyleSheet.create({
    overlay: {
        // Explicit window dimensions instead of `flex: 1`: a transparent overlay
        // root collapses to zero height on RN Fabric (Android new arch).
        width: VIEWER_WIDTH,
        height: VIEWER_HEIGHT,
        backgroundColor: 'rgba(0,0,0,0.95)',
        justifyContent: 'center',
    },
    closeButton: {
        position: 'absolute',
        top: 48,
        right: 20,
        zIndex: 10,
        padding: 8,
    },
});

/**
 * Full-screen, swipeable photo viewer. Opens at `initialIndex` and pages
 * horizontally through the entry's photos.
 */
const PhotoViewer: React.FC<{
    visible: boolean;
    photos: EntryPhoto[];
    initialIndex: number;
    onClose: () => void;
}> = ({ visible, photos, initialIndex, onClose }) => (
    <OverlayModal visible={visible} onClose={onClose} fullScreen>
        <View style={viewerStyles.overlay}>
            <Pressable
                style={viewerStyles.closeButton}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close photo viewer"
                hitSlop={16}
            >
                <Feather name="x" size={28} color="#fff" />
            </Pressable>
            <FlatList
                data={photos}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(p) => String(p.id)}
                initialScrollIndex={Math.min(initialIndex, Math.max(photos.length - 1, 0))}
                getItemLayout={(_, index) => ({
                    length: VIEWER_WIDTH,
                    offset: VIEWER_WIDTH * index,
                    index,
                })}
                renderItem={({ item }) => (
                    <Image
                        source={{ uri: item.file_path }}
                        style={{ width: VIEWER_WIDTH, height: VIEWER_HEIGHT * 0.85 }}
                        resizeMode="contain"
                    />
                )}
            />
        </View>
    </OverlayModal>
);

/**
 * A single thumbnail with a broken-image fallback. On load error (a missing
 * file on an old install, an orphaned path) we render a VISIBLE muted
 * placeholder with an icon — never an empty/invisible box — so the problem is
 * diagnosable instead of silently swallowed.
 */
const ThumbImage: React.FC<{
    uri: string;
    style: any;
    colors: ThemeColors;
    iconSize?: number;
}> = ({ uri, style, colors, iconSize = 28 }) => {
    const [failed, setFailed] = useState(false);
    if (failed) {
        return (
            <View
                style={[
                    style,
                    {
                        backgroundColor: colors.overlays.tag,
                        alignItems: 'center',
                        justifyContent: 'center',
                    },
                ]}
                accessibilityLabel="Photo unavailable"
            >
                <Feather name="image" size={iconSize} color={colors.textSecondary} />
            </View>
        );
    }
    return (
        <Image
            source={{ uri }}
            style={[style, { backgroundColor: colors.cardBackground }]}
            resizeMode="cover"
            onError={() => setFailed(true)}
        />
    );
};

const styles = StyleSheet.create({
    strip: {
        flexDirection: 'row',
        marginTop: 12,
    },
    thumb: {
        width: 80,
        height: 80,
        borderRadius: 10,
        marginRight: 8,
    },
    hero: {
        marginTop: 12,
        width: '100%',
        height: 150,
        borderRadius: 12,
    },
});

/**
 * Entry photos: ONE photo renders as a large full-width hero; MULTIPLE render
 * as a horizontal strip of 80px thumbnails. Tapping any photo opens the
 * full-screen PhotoViewer at that index. The single-vs-grid decision is the
 * pure `photoLayoutFor` helper.
 */
export const EntryPhotos: React.FC<{ photos: EntryPhoto[]; colors: ThemeColors }> = ({
    photos,
    colors,
}) => {
    const [viewerVisible, setViewerVisible] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);

    const layout = photoLayoutFor(photos.length);
    if (layout.kind === 'none') return null;

    const open = (index: number) => {
        setActiveIndex(index);
        setViewerVisible(true);
    };

    return (
        <>
            {layout.kind === 'single' ? (
                <Pressable
                    onPress={() => open(0)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="View photo 1"
                >
                    <ThumbImage uri={photos[0].file_path} style={styles.hero} colors={colors} iconSize={36} />
                </Pressable>
            ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
                    {photos.map((photo, index) => (
                        <Pressable
                            key={photo.id}
                            onPress={() => open(index)}
                            accessibilityRole="imagebutton"
                            accessibilityLabel={`View photo ${index + 1}`}
                        >
                            <ThumbImage uri={photo.file_path} style={styles.thumb} colors={colors} />
                        </Pressable>
                    ))}
                </ScrollView>
            )}
            <PhotoViewer
                visible={viewerVisible}
                photos={photos}
                initialIndex={activeIndex}
                onClose={() => setViewerVisible(false)}
            />
        </>
    );
};
