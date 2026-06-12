import React, {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
} from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * In-tree full-window overlay host.
 *
 * WHY THIS EXISTS — replacing native `<Modal>`:
 * On RN 0.76 Android new architecture (Fabric, `newArchEnabled: true`), a native
 * `<Modal>` renders into a SECOND native window with its own React/Fabric root.
 * Touch dispatch into that window is broken in the 0.76 line: the JS touch
 * dispatcher for the modal's root sees the DOWN but never the UP, so every
 * control inside the modal (scroll, buttons) is dead — to a REAL finger, not
 * just to synthetic adb/Maestro injection. Fixes landed in later RN versions we
 * can't reach on SDK 52 (facebook/react-native modal-window touch routing).
 *
 * The fix is to stop using a second native window entirely: render "modal"
 * content as an absolutely-positioned overlay that lives in the SAME React tree
 * / Fabric root as the rest of the app, so touch routing never crosses a window
 * boundary. Mounted as the LAST child of the root layout view, it paints above
 * everything — including the floating tab bar — without any native Modal.
 *
 * Callers use `useOverlay().mount(node)` to push content and get back a handle
 * whose `.unmount()` removes it. A component that wants modal-like behaviour
 * mounts/unmounts on its `visible` prop (see EntryFormModal).
 */

type OverlayHandle = {
    /** Replace this overlay's content (e.g. on theme/prop change). */
    update: (node: React.ReactNode) => void;
    /** Remove this overlay from the host. */
    unmount: () => void;
};

type OverlayContextValue = {
    /**
     * Mount `node` as a full-window overlay above all app content. Returns a
     * handle to update or remove it. Later mounts paint on top of earlier ones.
     */
    mount: (node: React.ReactNode) => OverlayHandle;
};

const OverlayContext = createContext<OverlayContextValue | null>(null);

type Entry = { id: number; node: React.ReactNode };

export function OverlayProvider({ children }: { children: React.ReactNode }) {
    const [entries, setEntries] = useState<Entry[]>([]);
    // Monotonic id generator — a ref so it survives re-renders without state churn.
    const nextId = useRef(0);

    const mount = useCallback((node: React.ReactNode): OverlayHandle => {
        const id = nextId.current++;
        setEntries((prev) => [...prev, { id, node }]);

        return {
            update: (next) =>
                setEntries((prev) =>
                    prev.map((e) => (e.id === id ? { ...e, node: next } : e))
                ),
            unmount: () => setEntries((prev) => prev.filter((e) => e.id !== id)),
        };
    }, []);

    const value = useMemo(() => ({ mount }), [mount]);

    return (
        <OverlayContext.Provider value={value}>
            {children}
            {/* Portal slot: each entry fills the window and stacks by mount order.
                `pointerEvents="box-none"` on the slot lets touches pass through the
                gaps to app content when no overlay is up; each overlay node sets
                its own backdrop / pointer behaviour. */}
            {entries.map((entry) => (
                <View
                    key={entry.id}
                    style={StyleSheet.absoluteFill}
                    pointerEvents="box-none"
                >
                    {entry.node}
                </View>
            ))}
        </OverlayContext.Provider>
    );
}

/**
 * Access the overlay host. Throws if used outside <OverlayProvider> so a missing
 * provider is a loud build-time-ish error, not a silently-dead modal.
 */
export function useOverlay(): OverlayContextValue {
    const ctx = useContext(OverlayContext);
    if (!ctx) {
        throw new Error('useOverlay must be used within an <OverlayProvider>');
    }
    return ctx;
}
