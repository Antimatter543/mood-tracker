import React, { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useOverlay } from '@/context/OverlayHost';
import { useThemeColors, ThemeColors } from '@/styles/global';
import {
    TAB_BAR_CONTENT_HEIGHT,
    TAB_BAR_CONTENT_PADDING_BOTTOM,
} from '@/lib/tabBarStyle';

/**
 * A transient bottom banner with ONE action — the undo affordance after a
 * destructive-looking tap ("Entry moved to the bin · UNDO").
 *
 * WHY it goes through the OverlayHost and not just an absolutely-positioned View
 * inside the screen: this app BANS react-native `<Modal>` (second native window,
 * dead touch dispatch on Fabric — see context/OverlayHost.tsx), and the overlay
 * host is the sanctioned in-tree replacement. It also renders AFTER `<Tabs>`, so
 * the snackbar paints above the floating tab bar instead of under it. It is NOT
 * built on `OverlayModal`: that adds a dimmed modal backdrop and swallows the
 * Android hardware back button, both wrong for a passive, non-blocking banner —
 * back should still navigate while a snackbar is up.
 *
 * The overlay slot is `pointerEvents="box-none"` and this content only occupies
 * the bar itself, so the rest of the screen stays fully interactive underneath.
 *
 * TOUCH RELIABILITY — read before restyling this (device QA 2026-09-03 found the
 * UNDO button unresponsive to real taps at uiautomator-verified coordinates,
 * while the JS callback chain tested green end-to-end). Three things here are
 * load-bearing, not decoration:
 *
 *  1. The action's touch target is at least MIN_TOUCH_TARGET (48dp) in BOTH
 *     axes. It used to be ~60x28dp — under every platform minimum — so a tap
 *     aimed at the label's own bounds could legitimately land outside the
 *     pressable box. Keep the explicit minWidth/minHeight; padding around a
 *     14px label does not get you there on its own.
 *  2. `pointerEvents="box-none"` sits on a PLAIN `View`, never on the
 *     reanimated `Animated.View`. Every other overlay in this app that works
 *     (OverlayModal's card layer, the OverlayHost slot) declares it on a plain
 *     View; the snackbar was the sole exception and the sole dead control.
 *  3. There is NO `exiting` layout animation. `exiting` makes reanimated own the
 *     view's removal and keep it alive past unmount, and this app already has a
 *     scar from reanimated-4-on-Fabric mangling layout (see the Statistics
 *     blank-screen note in components/PageContainer.tsx). A snackbar fading out
 *     is not worth a view that may outlive its own React tree on top of the UI.
 */

/**
 * How long the snackbar stays up before auto-dismissing.
 *
 * Material puts a snackbar-with-action at 4–10s; an undo for a DESTRUCTIVE
 * action belongs at the long end. It was 6s, which is a real race for anyone who
 * has to read the message, find the button and aim — and it silently expires
 * mid-attempt rather than failing visibly.
 */
export const UNDO_SNACKBAR_DURATION_MS = 8000;

/**
 * Minimum side of an interactive target, in dp. Android's own guidance is 48dp
 * (WCAG 2.5.5 says 44); we take the larger. Exported so a test can assert it
 * rather than re-hardcoding the number.
 */
export const MIN_TOUCH_TARGET = 48;

/** Clearance between the snackbar and the top of the floating tab bar. */
const GAP_ABOVE_TAB_BAR = 12;

type UndoSnackbarProps = {
    visible: boolean;
    message: string;
    /** The single action's label, e.g. "Undo". */
    actionLabel: string;
    onAction: () => void;
    /** Called on auto-timeout AND after `onAction`, so the host can clear state. */
    onDismiss: () => void;
    durationMs?: number;
};

export const UndoSnackbar: React.FC<UndoSnackbarProps> = ({
    visible,
    message,
    actionLabel,
    onAction,
    onDismiss,
    durationMs = UNDO_SNACKBAR_DURATION_MS,
}) => {
    const { mount } = useOverlay();
    const handleRef = useRef<ReturnType<typeof mount> | null>(null);

    // Latest-callback refs: the auto-dismiss timer below must NOT be restarted
    // just because the parent re-rendered with new closure identities, otherwise
    // a snackbar over a re-rendering list would never time out.
    const onActionRef = useRef(onAction);
    onActionRef.current = onAction;
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    const content = (
        <SnackbarContent
            message={message}
            actionLabel={actionLabel}
            onAction={() => {
                onActionRef.current();
                onDismissRef.current();
            }}
        />
    );

    // Mount/unmount strictly on `visible` (mirrors OverlayModal), and refresh the
    // content in place on any other change so a re-render never restarts the
    // entrance animation.
    useEffect(() => {
        if (!visible) return;
        const handle = mount(content);
        handleRef.current = handle;
        return () => {
            handle.unmount();
            handleRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount on visibility only; content refreshed below
    }, [visible, mount]);

    useEffect(() => {
        if (!visible) return;
        handleRef.current?.update(content);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `content` rebuilt each render from these
    }, [visible, message, actionLabel]);

    // Auto-dismiss. Keyed on `message` as well as `visible` so a SECOND delete
    // while the first snackbar is still up restarts the countdown rather than
    // inheriting the first one's remaining time.
    useEffect(() => {
        if (!visible) return;
        const timer = setTimeout(() => onDismissRef.current(), durationMs);
        return () => clearTimeout(timer);
    }, [visible, message, durationMs]);

    return null;
};

const SnackbarContent: React.FC<{
    message: string;
    actionLabel: string;
    onAction: () => void;
}> = ({ message, actionLabel, onAction }) => {
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();
    const styles = useStyles(colors);

    // Sit just above the floating tab bar, whose real height is its content
    // height PLUS the bottom safe-area inset (see lib/tabBarStyle.ts).
    const bottom =
        TAB_BAR_CONTENT_HEIGHT +
        TAB_BAR_CONTENT_PADDING_BOTTOM +
        insets.bottom +
        GAP_ABOVE_TAB_BAR;

    return (
        // Plain View, not the animated one: `pointerEvents` belongs on a host
        // View here — see the TOUCH RELIABILITY note at the top of the file.
        <View
            testID="undo-snackbar-slot"
            style={[styles.wrapper, { bottom }]}
            pointerEvents="box-none"
        >
            <Animated.View testID="undo-snackbar" entering={FadeInDown.duration(180)} style={styles.bar}>
                <Text style={styles.message} numberOfLines={2}>
                    {message}
                </Text>
                <Pressable
                    testID="undo-snackbar-action"
                    onPress={onAction}
                    accessibilityRole="button"
                    accessibilityLabel={actionLabel}
                    // Generous, ASYMMETRIC slop: the bar's own padding is the only
                    // thing between this button and the screen edge, and a thumb
                    // reaching the bottom-right corner of the screen consistently
                    // undershoots. Slop costs nothing — there is no other target
                    // inside the bar to steal from.
                    hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                    style={styles.action}
                >
                    <Text style={styles.actionText}>{actionLabel}</Text>
                </Pressable>
            </Animated.View>
        </View>
    );
};

const useStyles = (colors: ThemeColors) =>
    React.useMemo(
        () =>
            StyleSheet.create({
                // Pinned to the bottom of the overlay slot; `box-none` so only the
                // bar itself takes touches and the screen stays usable behind it.
                wrapper: {
                    position: 'absolute',
                    left: 16,
                    right: 16,
                },
                bar: {
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    paddingVertical: 14,
                    paddingLeft: 16,
                    paddingRight: 8,
                    borderRadius: 14,
                    // Elevated surface, not the page background — a snackbar has to
                    // read as floating above the list it just changed.
                    backgroundColor: colors.secondaryBackground,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: colors.border,
                    shadowColor: colors.elevation.shadowColor,
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: colors.elevation.shadowOpacity,
                    shadowRadius: colors.elevation.shadowRadius,
                    elevation: colors.elevation.elevation,
                },
                message: {
                    flex: 1,
                    color: colors.text,
                    fontSize: 14,
                    lineHeight: 19,
                },
                // A REAL touch target, not just padding around a 14px label: at
                // least 48dp on both axes (see MIN_TOUCH_TARGET). The label is
                // centred inside it, so the button looks the same as before while
                // the box a finger actually has to hit is ~2.5x taller.
                action: {
                    minWidth: MIN_TOUCH_TARGET,
                    minHeight: MIN_TOUCH_TARGET,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 12,
                },
                actionText: {
                    color: colors.accent,
                    fontSize: 14,
                    fontWeight: '700',
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                },
            }),
        [colors]
    );
