// EntryForm.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    TextInput,
    Image,
    ScrollView,
    Alert,
    ActivityIndicator,
    BackHandler,
} from 'react-native';
import Animated, { FadeIn, useAnimatedRef } from 'react-native-reanimated';
import type { AnimatedRef } from 'react-native-reanimated';
import * as ImagePicker from 'expo-image-picker';
import { ThemeColors, useThemeColors } from '@/styles/global';
import Ionicons from '@expo/vector-icons/Ionicons';
import Feather from '@expo/vector-icons/Feather';

import { ActivitySelector } from './ActivitySelector';
import MoodSelector from './MoodSelector';
import InfoBubble from '../InfoBubble';
import { DatePicker } from './DatePicker';
import { useSettings } from '@/context/SettingsContext';
import { useOverlay } from '@/context/OverlayHost';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useEntryDraft, EntryDraft } from './hooks/useEntryDraft';
import { selectPhotosToAdd } from './photoSelection';

const MAX_PHOTOS = 5;

/**
 * Inline photo-attachment affordance for the entry form. Offers camera +
 * library, requests the matching permission on tap, and renders a horizontal
 * thumbnail strip with a per-photo remove (×) button. The selected URIs live in
 * the draft (`photos`); copying into the persistent media dir happens later at
 * save time (addMoodEntry / handleUpdate), so cancelling the form leaves no
 * files on disk.
 */
const PhotoAttachments = ({
    photos,
    onAdd,
    onRemove,
}: {
    photos: string[];
    onAdd: (uri: string) => void;
    onRemove: (uri: string) => void;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const [loading, setLoading] = useState(false);

    const pick = async (source: 'camera' | 'library') => {
        if (photos.length >= MAX_PHOTOS) {
            Alert.alert('Limit reached', `You can attach up to ${MAX_PHOTOS} photos.`);
            return;
        }

        const perm =
            source === 'camera'
                ? await ImagePicker.requestCameraPermissionsAsync()
                : await ImagePicker.requestMediaLibraryPermissionsAsync();

        if (!perm.granted) {
            Alert.alert(
                'Permission required',
                source === 'camera'
                    ? 'Camera access is needed to take a photo.'
                    : 'Photo library access is needed to attach a photo.'
            );
            return;
        }

        setLoading(true);
        try {
            if (source === 'camera') {
                // Camera is single-shot.
                const result = await ImagePicker.launchCameraAsync({
                    mediaTypes: ['images'],
                    quality: 0.8,
                });
                if (!result.canceled && result.assets?.[0]) {
                    onAdd(result.assets[0].uri);
                }
                return;
            }

            // Library: allow multi-select, hinting the picker to cap at the
            // remaining slots. selectionLimit is best-effort on some Android
            // pickers, so selectPhotosToAdd enforces the real cap in code.
            const remaining = MAX_PHOTOS - photos.length;
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.8,
                allowsMultipleSelection: true,
                selectionLimit: remaining,
            });

            if (result.canceled || !result.assets?.length) return;

            const { toAdd, limitHit } = selectPhotosToAdd(
                photos,
                result.assets.map((a) => a.uri),
                MAX_PHOTOS,
            );
            toAdd.forEach(onAdd);

            if (limitHit) {
                Alert.alert(
                    'Limit reached',
                    `Only the first ${toAdd.length} added — you can attach up to ${MAX_PHOTOS} photos.`,
                );
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={styles.photoContainer}>
            <View style={styles.photoHeaderRow}>
                <Text style={styles.label}>Photos</Text>
                <View style={styles.photoAddButtons}>
                    {loading ? (
                        <ActivityIndicator color={colors.accent} />
                    ) : (
                        <>
                            <Pressable
                                style={styles.photoIconButton}
                                onPress={() => pick('camera')}
                                accessibilityRole="button"
                                accessibilityLabel="Take photo"
                                hitSlop={8}
                            >
                                <Feather name="camera" size={20} color={colors.text} />
                            </Pressable>
                            <Pressable
                                style={styles.photoIconButton}
                                onPress={() => pick('library')}
                                accessibilityRole="button"
                                accessibilityLabel="Choose photo from library"
                                hitSlop={8}
                            >
                                <Feather name="image" size={20} color={colors.text} />
                            </Pressable>
                        </>
                    )}
                </View>
            </View>

            {photos.length > 0 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.photoStrip}
                >
                    {photos.map((uri) => (
                        <View key={uri} style={styles.photoThumbWrap}>
                            <Image
                                source={{ uri }}
                                style={styles.photoThumb}
                                resizeMode="cover"
                            />
                            <Pressable
                                style={styles.photoRemoveButton}
                                onPress={() => onRemove(uri)}
                                accessibilityRole="button"
                                accessibilityLabel="Remove photo"
                                hitSlop={8}
                            >
                                <Feather name="x" size={12} color="#fff" />
                            </Pressable>
                        </View>
                    ))}
                </ScrollView>
            )}
        </View>
    );
};

// Types
type EntryFormProps = {
    initialData?: EntryFormData;
    onSubmit: (data: EntryFormData) => Promise<void>;
    onCancel: () => void;
};

// Kept for backward compatibility with callers (AddEntryButton etc.) — the
// hook's `EntryDraft` is the same shape.
export type EntryFormData = EntryDraft;

// Internal Components
const MoodStep = ({
    value,
    onChange,
    onContinue,
    date,
    onDateChange,
    moodError,
}: {
    value: number;
    onChange: (mood: number) => void;
    onContinue: () => void;
    date: Date;
    onDateChange: (date: Date) => void;
    moodError?: string;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);
    const { settings } = useSettings();

    const moodPrecision = settings.mood_precision;
    const showMoodBenchmarks = settings.show_mood_benchmarks;

    return (
        <>
            <Text style={styles.title}>How were you?</Text>
            <MoodSelector
                onValueChange={onChange}
                initialValue={value}
                precision={moodPrecision}
                showBenchmarks={showMoodBenchmarks}
            />
            <DatePicker date={date} onDateChange={onDateChange} />

            {moodError ? (
                <Text style={styles.errorText} accessibilityRole="alert">
                    {moodError}
                </Text>
            ) : null}

            <Pressable
                style={[styles.continueButton, !!moodError && styles.continueButtonDisabled]}
                onPress={onContinue}
                accessibilityState={{ disabled: !!moodError }}
                disabled={!!moodError}
            >
                <Text style={styles.continueButtonText}>Continue</Text>
            </Pressable>
        </>
    );
};

const DetailsStep = ({
    activities,
    notes,
    photos,
    onToggleActivity,
    onNotesChange,
    onNotesFocus,
    onAddPhoto,
    onRemovePhoto,
    onBack,
    onSubmit,
    submitDisabled,
    scrollableRef,
}: {
    activities: number[];
    notes: string;
    photos: string[];
    onToggleActivity: (activityId: number) => void;
    onNotesChange: (notes: string) => void;
    /** Fired when the Notes input focuses — the form scrolls it above the keyboard. */
    onNotesFocus?: () => void;
    onAddPhoto: (uri: string) => void;
    onRemovePhoto: (uri: string) => void;
    onBack: () => void;
    onSubmit: () => void;
    submitDisabled?: boolean;
    scrollableRef?: AnimatedRef<Animated.ScrollView>;
}) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    return (
        <>
            <Text style={styles.title}>What did you do?</Text>
            <ActivitySelector
                onSelectActivity={onToggleActivity}
                selectedActivities={activities}
                scrollableRef={scrollableRef}
            />

            <Text style={styles.label}>Notes:</Text>
            <TextInput
                style={styles.noteInput}
                value={notes}
                onChangeText={onNotesChange}
                onFocus={onNotesFocus}
                placeholder="How are you feeling?"
                placeholderTextColor={colors.textSecondary}
                multiline
                numberOfLines={3}
            />

            <PhotoAttachments
                photos={photos}
                onAdd={onAddPhoto}
                onRemove={onRemovePhoto}
            />

            <View style={styles.buttonContainer}>
                <Pressable
                    style={[styles.navigationButton, styles.backButton]}
                    onPress={onBack}
                >
                    <Text style={styles.buttonText}>Back</Text>
                </Pressable>
                <Pressable
                    style={[
                        styles.navigationButton,
                        styles.submitButton,
                        submitDisabled && styles.continueButtonDisabled,
                    ]}
                    onPress={onSubmit}
                    disabled={submitDisabled}
                    accessibilityState={{ disabled: !!submitDisabled }}
                >
                    <Text style={styles.buttonText}>Submit</Text>
                </Pressable>
            </View>
        </>
    );
};

// Full-window overlay content for the entry form. Rendered THROUGH the root
// OverlayProvider (not a native <Modal>) so touch dispatch stays in the single
// Fabric root — a native <Modal>'s second window has dead touch routing on
// RN 0.76 new arch (the mood picker/Continue do not respond to a real finger).
// See context/OverlayHost.tsx + tasks/lessons.md.
const EntryFormOverlay: React.FC<{
    onClose: () => void;
    initialData?: EntryFormData;
    onSubmit: (data: EntryFormData) => Promise<void>;
}> = ({ onClose, initialData, onSubmit }) => {
    const colors = useThemeColors();
    const styles = useThemedStyles(colors);

    // Replicate <Modal onRequestClose>: Android hardware back closes the overlay
    // while it's up (and swallows the event so it doesn't pop the route under it).
    useEffect(() => {
        const sub = BackHandler.addEventListener('hardwareBackPress', () => {
            onClose();
            return true;
        });
        return () => sub.remove();
    }, [onClose]);

    return (
        <Animated.View
            entering={FadeIn.duration(150)}
            style={[styles.modalContainer, StyleSheet.absoluteFill]}
        >
            <View style={styles.modalHeader}>
                <Pressable style={styles.closeButton} onPress={onClose}>
                    <Ionicons name="close" color={colors.text} size={24} />
                </Pressable>

                <InfoBubble
                    text="Hold an activity to edit or delete it"
                    position="top-right"
                />
            </View>

            {/* The entry form's own ScrollView handles keeping the focused input
                above the keyboard (it pads its content by the keyboard height and
                scrolls the Notes field into view). A KeyboardAvoidingView is NOT
                used here: under enforced edge-to-edge (SDK 56 / RN 0.85 /
                targetSdk 36) `behavior=undefined` is a no-op on Android and even
                an active KAV won't pan a ScrollView to the focused field — see
                EntryForm + useKeyboardHeight + tasks/lessons.md. */}
            <EntryForm
                initialData={initialData}
                onSubmit={onSubmit}
                onCancel={onClose}
            />
        </Animated.View>
    );
};

// Public API is UNCHANGED (visible/onClose/onSubmit/initialData) so callers
// (AddEntryButton, DBViewer) don't change. Internally this mounts the form as an
// in-tree overlay via the root OverlayProvider instead of a native <Modal>.
export const EntryFormModal: React.FC<{
    visible: boolean;
    onClose: () => void;
    initialData?: EntryFormData;
    onSubmit: (data: EntryFormData) => Promise<void>;
}> = ({ visible, onClose, initialData, onSubmit }) => {
    const { mount } = useOverlay();
    const handleRef = useRef<ReturnType<typeof mount> | null>(null);

    // Mount/unmount strictly on `visible` so the overlay (and the form's draft/step
    // state inside it) is NOT torn down when an unrelated parent re-render gives
    // onClose/onSubmit a new identity.
    useEffect(() => {
        if (!visible) return;
        const handle = mount(<EntryFormOverlay onClose={onClose} initialData={initialData} onSubmit={onSubmit} />);
        handleRef.current = handle;
        return () => {
            handle.unmount();
            handleRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount on visibility only; content refreshed by the effect below
    }, [visible, mount]);

    // Refresh the live overlay content in place when props change (e.g. theme via
    // useThemeColors re-render, new initialData) without remounting.
    useEffect(() => {
        if (!visible) return;
        handleRef.current?.update(<EntryFormOverlay onClose={onClose} initialData={initialData} onSubmit={onSubmit} />);
    }, [visible, onClose, initialData, onSubmit]);

    return null;
};

// Main Component — render layer only. All state lives in useEntryDraft.
export const EntryForm: React.FC<EntryFormProps> = ({
    initialData,
    onSubmit,
    onCancel: _onCancel,
}) => {
    const [currentStep, setCurrentStep] = useState(1);
    const {
        draft,
        setMood,
        setNotes,
        toggleActivity,
        setDate,
        addPhoto,
        removePhoto,
        validation,
        isValid,
        submit,
    } = useEntryDraft(initialData);
    const colors = useThemeColors();
    // Live keyboard height (0 when hidden). Padding the scroll content by it
    // gives the physical scroll RANGE that adjustResize no longer provides under
    // edge-to-edge — without it the content fits the window exactly and there's
    // nothing to scroll, so the keyboard sits on top of the Notes field.
    const keyboardHeight = useKeyboardHeight();
    const styles = useThemedStyles(colors);
    // Animated ref to the form's scroll container, threaded into the activity
    // drag-reorder grid so it can auto-scroll the form while a chip is dragged
    // near an edge (react-native-sortables scrollableRef). Its `.current` also
    // exposes the ScrollView's scrollToEnd, used to lift the Notes field above
    // the keyboard.
    const scrollRef = useAnimatedRef<Animated.ScrollView>();

    const handleSubmit = async () => {
        // submit() runs validation again before invoking onSubmit, so we never
        // hit the DB with a bad mood value — the pre-submit UI guard is
        // duplicated by the hook for safety.
        await submit(onSubmit);
    };

    // Scroll the bottom of the form (Notes + photos + Submit) into view above
    // the keyboard. Notes is the last input, so scrollToEnd reliably brings it
    // (and the Submit button) into the now-padded scrollable region.
    const scrollToBottom = useCallback(() => {
        // rAF so the contentContainer's keyboard padding (driven by the keyboard
        // height from useAnimatedKeyboard) is laid out before we scroll.
        requestAnimationFrame(() => {
            scrollRef.current?.scrollToEnd({ animated: true });
        });
    }, [scrollRef]);

    // When the keyboard opens while on the details step, scroll to the bottom so
    // the focused Notes field clears it. (onFocus also triggers this for instant
    // feedback the moment the field is tapped, before the keyboard finishes.)
    useEffect(() => {
        if (keyboardHeight > 0 && currentStep === 2) {
            scrollToBottom();
        }
    }, [keyboardHeight, currentStep, scrollToBottom]);

    return (
        <Animated.ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={[
                styles.contentContainer,
                // Extra bottom room == keyboard height so the last field can sit
                // above the keyboard. 0 when hidden (no-op).
                { paddingBottom: styles.contentContainer.paddingBottom + keyboardHeight },
            ]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
        >
            {currentStep === 1 ? (
                <MoodStep
                    value={draft.mood}
                    onChange={setMood}
                    onContinue={() => setCurrentStep(2)}
                    date={draft.date}
                    onDateChange={setDate}
                    moodError={validation.errors.mood}
                />
            ) : (
                <DetailsStep
                    activities={draft.activities}
                    notes={draft.notes}
                    photos={draft.photos}
                    onToggleActivity={toggleActivity}
                    onNotesChange={setNotes}
                    onNotesFocus={scrollToBottom}
                    onAddPhoto={addPhoto}
                    onRemovePhoto={removePhoto}
                    onBack={() => setCurrentStep(1)}
                    onSubmit={handleSubmit}
                    submitDisabled={!isValid}
                    scrollableRef={scrollRef}
                />
            )}
        </Animated.ScrollView>
    );
};

// Styles
const useThemedStyles = (colors: ThemeColors) =>
    StyleSheet.create({
        modalContainer: {
            // Rendered as an in-tree overlay (StyleSheet.absoluteFill, applied at
            // the call site) — it fills the whole window via the root portal slot,
            // so no explicit Dimensions sizing is needed (that was the old native
            // <Modal> Fabric flex-collapse workaround, gone with the Modal).
            backgroundColor: colors.background,
            paddingTop: 16,
        },
        modalHeader: {
            paddingHorizontal: 12,
            flexDirection: 'row',
            justifyContent: 'flex-start',
            marginBottom: 8,
        },
        closeButton: {
            padding: 8,
        },
        scroll: {
            flex: 1,
        },
        contentContainer: {
            // flexGrow (not flex) so the content stays vertically centred when it
            // fits the viewport, but grows past it and scrolls when it doesn't —
            // guarantees the Continue/Submit button is always reachable on small
            // screens. Vertical padding gives breathing room at both ends.
            flexGrow: 1,
            paddingTop: 8,
            paddingBottom: 24,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 20,
        },
        title: {
            color: colors.text,
            marginTop: -15,
            fontSize: 24,
            fontWeight: 'bold',
            marginBottom: 15,
        },
        label: {
            color: colors.text,
            fontSize: 16,
            marginBottom: 8,
            alignSelf: 'flex-start',
        },
        noteInput: {
            backgroundColor: colors.cardBackground,
            borderRadius: 8,
            padding: 12,
            color: colors.text,
            fontSize: 16,
            width: '100%',
            minHeight: 100,
            textAlignVertical: 'top',
        },
        buttonContainer: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            width: '100%',
            marginTop: 20,
        },
        navigationButton: {
            flex: 1,
            padding: 15,
            borderRadius: 25,
            alignItems: 'center',
            marginHorizontal: 5,
        },
        backButton: {
            backgroundColor: colors.overlays.tag,
        },
        submitButton: {
            backgroundColor: colors.accent,
        },
        buttonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: '600',
        },
        continueButton: {
            backgroundColor: colors.accent,
            margin: 20,
            padding: 15,
            borderRadius: 25,
            alignItems: 'center',
            width: '100%',
        },
        continueButtonDisabled: {
            opacity: 0.5,
        },
        continueButtonText: {
            color: colors.text,
            fontSize: 16,
            fontWeight: 'bold',
        },
        errorText: {
            color: '#ff6b6b',
            fontSize: 14,
            marginTop: 8,
            alignSelf: 'flex-start',
        },
        photoContainer: {
            width: '100%',
            marginTop: 16,
        },
        photoHeaderRow: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
        },
        photoAddButtons: {
            flexDirection: 'row',
            gap: 8,
            minHeight: 44,
            alignItems: 'center',
        },
        photoIconButton: {
            backgroundColor: colors.overlays.tag,
            borderRadius: 22,
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
        },
        photoStrip: {
            flexDirection: 'row',
        },
        photoThumbWrap: {
            position: 'relative',
            marginRight: 8,
        },
        photoThumb: {
            width: 72,
            height: 72,
            borderRadius: 8,
            backgroundColor: colors.cardBackground,
        },
        photoRemoveButton: {
            position: 'absolute',
            top: 2,
            right: 2,
            backgroundColor: 'rgba(0,0,0,0.6)',
            borderRadius: 10,
            padding: 3,
        },
    });
