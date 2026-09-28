import React from 'react';
import {
    View,
    Pressable,
    ScrollView,
    StyleSheet,
    Dimensions,
    FlatList,
} from 'react-native';
import { Image } from 'expo-image';
import { useRecyclingState } from '@shopify/flash-list';
import Feather from '@expo/vector-icons/Feather';
import { EntryPhoto } from '../types';
import { ThemeColors } from '@/styles/global';
import { OverlayModal } from '../OverlayModal';
import { photoLayoutFor } from './photoLayout';

const { width: VIEWER_WIDTH, height: VIEWER_HEIGHT } = Dimensions.get('window');

/**
 * Photo box sizes. FIXED, never derived from the image: the Timeline is a
 * virtualized list that positions every cell from its measured height, so a
 * photo that resized its cell when it finished decoding would move every row
 * below it — the same class of layout shift the 2026-09-28 fling fix removed.
 * The hero stretches to the card's width (that is known at layout time and
 * never changes), but its HEIGHT is a constant.
 */
export const PHOTO_HERO_HEIGHT = 168;
export const PHOTO_THUMB_SIZE = 84;

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
                        contentFit="contain"
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
 * diagnosable instead of silently swallowed. The placeholder takes the SAME box
 * as the image, so a failure never changes the cell's height either.
 *
 * RECYCLING: this lives inside a FlashList cell, and FlashList re-uses a cell's
 * component instance for a DIFFERENT entry as the user scrolls. A plain
 * `useState(false)` would carry `failed = true` from one entry's missing file
 * onto the next entry's perfectly good photo. `useRecyclingState` resets it
 * whenever the uri changes. `recyclingKey` does the same for expo-image's own
 * native view, so a recycled cell never flashes the previous entry's picture
 * while the new one decodes.
 */
export const ThumbImage: React.FC<{
    uri: string;
    style: any;
    colors: ThemeColors;
    iconSize?: number;
}> = ({ uri, style, colors, iconSize = 28 }) => {
    const [failed, setFailed] = useRecyclingState(false, [uri]);
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
            recyclingKey={uri}
            style={[style, { backgroundColor: colors.overlays.tag }]}
            contentFit="cover"
            transition={120}
            onError={() => setFailed(true)}
        />
    );
};

const styles = StyleSheet.create({
    strip: {
        marginTop: 12,
    },
    stripContent: {
        gap: 8,
    },
    thumb: {
        width: PHOTO_THUMB_SIZE,
        height: PHOTO_THUMB_SIZE,
        borderRadius: 10,
    },
    // The Pressable wrapper must stretch to the card body width, otherwise it
    // shrink-wraps the image's intrinsic size and the hero `width:'100%'`
    // resolves against that collapsed box (a portrait photo renders ~40% wide).
    heroWrap: {
        alignSelf: 'stretch',
        marginTop: 12,
    },
    hero: {
        width: '100%',
        height: PHOTO_HERO_HEIGHT,
        borderRadius: 12,
    },
});

/** Stable identity of a photo set, so recycled state resets per entry. */
const photoSetKey = (photos: EntryPhoto[]): string =>
    photos.map((p) => `${p.id}:${p.file_path}`).join('|');

/**
 * Entry photos: ONE photo renders as a large full-width hero; MULTIPLE render
 * as a horizontal strip of thumbnails. Tapping any photo opens the full-screen
 * PhotoViewer at that index. The single-vs-grid decision is the pure
 * `photoLayoutFor` helper.
 *
 * The viewer's open/index state is recycling state for the same reason as
 * ThumbImage's: a cell recycled to another entry must not arrive with the
 * previous entry's viewer open (or opened at its index).
 */
export const EntryPhotos: React.FC<{ photos: EntryPhoto[]; colors: ThemeColors }> = ({
    photos,
    colors,
}) => {
    const setKey = photoSetKey(photos);
    const [viewerVisible, setViewerVisible] = useRecyclingState(false, [setKey]);
    const [activeIndex, setActiveIndex] = useRecyclingState(0, [setKey]);

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
                    style={styles.heroWrap}
                    onPress={() => open(0)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="View photo 1"
                >
                    <ThumbImage uri={photos[0].file_path} style={styles.hero} colors={colors} iconSize={36} />
                </Pressable>
            ) : (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.strip}
                    contentContainerStyle={styles.stripContent}
                >
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
