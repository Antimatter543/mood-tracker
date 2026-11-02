// EntryForm.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
    LayoutChangeEvent,
    NativeScrollEvent,
    NativeSyntheticEvent,
    TextInput,
    Image,
    ScrollView,
    Alert,
    ActivityIndicator,
    BackHandler,
} from 'react-native';
import Animated, { FadeIn, useAnimatedRef } from 'react-native-reanimated';
import type { AnimatedRef } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useSingleFlight } from '@/hooks/useSingleFlight';
import { useEntryDraft, EntryDraft } from './hooks/useEntryDraft';
import { selectPhotosToAdd } from './photoSelection';
import {
    FLOATING_ACTION_SIZE,
    floatingActionBottom,
    floatingActionOffsets,
    isRowFullyVisible,
    RowLayout,
} from './floatingActions';

const MAX_PHOTOS = 5;

// Breathing room between the top safe-area edge and the overlay's header row.
const MODAL_TOP_GAP = 8;

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
    /**
     * Bottom safe-area inset of the window the form is drawn in (the overlay
     * passes it). Added to the scroll content's bottom padding so the last
     * button scrolls clear of the Android nav bar. Defaults to 0.
     */
    bottomInset?: number;
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
                accessibilityRole="button"
                accessibilityLabel="Continue to the details step"
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
    onButtonRowLayout,
    submitDisabled,
    submitBusy,
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
    /** Where the Back + Submit row sits in the scroll content (drives the floating pair). */
    onButtonRowLayout?: (event: LayoutChangeEvent) => void;
    submitDisabled?: boolean;
    /** In-flight save: the button is disabled AND announced busy. */
    submitBusy?: boolean;
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

            <View
                testID="entry-form-button-row"
                style={styles.buttonContainer}
                onLayout={onButtonRowLayout}
            >
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
                    accessibilityState={{ disabled: !!submitDisabled, busy: !!submitBusy }}
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
    // The overlay is StyleSheet.absoluteFill at the window root, so under
    // edge-to-edge it sits behind BOTH system bars and owns both insets. The top
    // one is applied ONCE, on the container below (the header and the form's
    // scroll area both sit under it); the bottom one is handed to the form so
    // its last button can scroll clear of the nav bar.
    const insets = useSafeAreaInsets();

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
            style={[
                styles.modalContainer,
                StyleSheet.absoluteFill,
                { paddingTop: insets.top + MODAL_TOP_GAP },
            ]}
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
                bottomInset={insets.bottom}
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
    bottomInset = 0,
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

    // Is the inline Back + Submit row fully on screen? When it is not (a long
    // entry pushed it below the fold), a floating Back / Save pair stands in for
    // it. Worked out from the row's onLayout + the ScrollView's scroll offset,
    // viewport height and the keyboard height (see floatingActions.ts): no
    // polling, and it only does work while the details step is mounted, since
    // that is the only step that reports a row layout. The metrics live in refs
    // so scrolling re-renders nothing; only a flip of the boolean does.
    const [buttonsVisible, setButtonsVisible] = useState(true);
    const rowLayoutRef = useRef<RowLayout | null>(null);
    const scrollYRef = useRef(0);
    const viewportHeightRef = useRef(0);
    const keyboardHeightRef = useRef(keyboardHeight);
    keyboardHeightRef.current = keyboardHeight;

    const recomputeButtonsVisible = useCallback(() => {
        setButtonsVisible(
            isRowFullyVisible({
                row: rowLayoutRef.current,
                scrollY: scrollYRef.current,
                viewportHeight: viewportHeightRef.current,
                keyboardHeight: keyboardHeightRef.current,
            })
        );
    }, []);

    const handleScroll = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const { contentOffset, layoutMeasurement } = event.nativeEvent;
            scrollYRef.current = contentOffset.y;
            viewportHeightRef.current = layoutMeasurement.height;
            if (rowLayoutRef.current) recomputeButtonsVisible();
        },
        [recomputeButtonsVisible]
    );

    const handleViewportLayout = useCallback(
        (event: LayoutChangeEvent) => {
            viewportHeightRef.current = event.nativeEvent.layout.height;
            recomputeButtonsVisible();
        },
        [recomputeButtonsVisible]
    );

    const handleButtonRowLayout = useCallback(
        (event: LayoutChangeEvent) => {
            const { y, height } = event.nativeEvent.layout;
            rowLayoutRef.current = { y, height };
            recomputeButtonsVisible();
        },
        [recomputeButtonsVisible]
    );

    // The keyboard changes the visible band without a scroll or layout event.
    useEffect(() => {
        recomputeButtonsVisible();
    }, [keyboardHeight, recomputeButtonsVisible]);

    // Leaving the details step unmounts the row: forget its stale position so
    // coming back starts from "visible" until the row lays out again.
    useEffect(() => {
        if (currentStep !== 2) {
            rowLayoutRef.current = null;
            setButtonsVisible(true);
        }
    }, [currentStep]);

    const { settings } = useSettings();
    // `fab_position` honors the user's left/right preference. The settings
    // registry constrains the value to `'left' | 'right'` so we don't risk
    // injecting a runtime style key here.
    const fabPosition = settings.fab_position;

    // submit() runs validation again before invoking onSubmit, so we never hit
    // the DB with a bad mood value - the pre-submit UI guard is duplicated by
    // the hook for safety.
    const doSubmit = useCallback(async () => {
        await submit(onSubmit);
    }, [submit, onSubmit]);

    // ONE write per gesture. A rapid double-tap delivers both presses before the
    // `disabled` re-render lands, which is how a single fast double-tap once
    // produced TWO identical entries (device QA 2026-09-05, count 35 -> 37).
    // useSingleFlight's synchronous ref gate is what actually stops the second
    // one; the flag releases on settle, so a FAILED save re-enables the button
    // and the user can retry.
    const { inFlight: isSubmitting, run: handleSubmit } = useSingleFlight(doSubmit);
    const floatingOffsets = floatingActionOffsets(fabPosition);
    const floatingBottom = floatingActionBottom(bottomInset, keyboardHeight);
    const submitDisabled = !isValid || isSubmitting;

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
        <>
            <Animated.ScrollView
                ref={scrollRef}
                style={styles.scroll}
                contentContainerStyle={[
                    styles.contentContainer,
                    // The bottom inset keeps the buttons clear of the nav bar; the
                    // extra room == keyboard height lets the last field sit above
                    // the keyboard (0 when hidden, a no-op).
                    {
                        paddingBottom:
                            styles.contentContainer.paddingBottom + bottomInset + keyboardHeight,
                    },
                ]}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                onLayout={handleViewportLayout}
                onScroll={handleScroll}
                scrollEventThrottle={16}
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
                        onButtonRowLayout={handleButtonRowLayout}
                        submitDisabled={submitDisabled}
                        submitBusy={isSubmitting}
                        scrollableRef={scrollRef}
                    />
                )}
            </Animated.ScrollView>

            {!buttonsVisible && currentStep === 2 && (
                <>
                    <Pressable
                        testID="entry-form-floating-back"
                        style={[
                            styles.floatingButton,
                            styles.floatingBackButton,
                            { bottom: floatingBottom },
                            floatingOffsets.back,
                        ]}
                        onPress={() => setCurrentStep(1)}
                        accessibilityRole="button"
                        accessibilityLabel="Back to mood"
                    >
                        <Feather name="chevron-left" size={28} color={colors.text} />
                    </Pressable>

                    {/* Same guarded handler + disabled state as the inline Submit:
                        useSingleFlight's ref gate makes a double-tap ONE write. */}
                    <Pressable
                        testID="entry-form-floating-save"
                        style={[
                            styles.floatingButton,
                            styles.submitButton,
                            { bottom: floatingBottom },
                            floatingOffsets.save,
                            submitDisabled && styles.continueButtonDisabled,
                        ]}
                        onPress={handleSubmit}
                        disabled={submitDisabled}
                        accessibilityRole="button"
                        accessibilityLabel="Save entry"
                        accessibilityState={{ disabled: submitDisabled, busy: isSubmitting }}
                    >
                        <Feather name="check" size={26} color={colors.text} />
                    </Pressable>
                </>
            )}
        </>
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
            // The top safe-area padding is added at the call site (it needs the
            // live insets); horizontal gutters belong to `contentContainer`.
            backgroundColor: colors.background,
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
            // screens. Vertical padding gives breathing room at both ends. The
            // bottom safe-area inset and the keyboard height are added on top of
            // paddingBottom at the call site.
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
        floatingButton: {
            // `bottom` and the left/right offset are set at the call site (live
            // insets/keyboard + the fab_position side, see floatingActions.ts).
            position: 'absolute',
            zIndex: 1000,
            width: FLOATING_ACTION_SIZE,
            height: FLOATING_ACTION_SIZE,
            borderRadius: FLOATING_ACTION_SIZE / 2,
            justifyContent: 'center',
            alignItems: 'center',
            // Theme-aware shadow for visual depth.
            shadowColor: colors.elevation.shadowColor,
            shadowOffset: { width: 0, height: 3 },
            shadowOpacity: colors.elevation.shadowOpacity + 0.05,
            shadowRadius: colors.elevation.shadowRadius,
            elevation: colors.elevation.elevation + 2,
        },
        floatingBackButton: {
            backgroundColor: colors.secondaryBackground,
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
