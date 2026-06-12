import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { OverlayProvider } from "@/context/OverlayHost";

export default function RootLayout() {
    return (
        // GestureHandlerRootView stays at the app root for RNGH touch/gesture
        // delivery (react-navigation / react-native-screens use it transitively).
        // OverlayProvider hosts our in-tree modal replacement: overlays mount as
        // the LAST child of this root view, so they paint above the tab bar while
        // staying in the SAME Fabric root (native <Modal>'s second window breaks
        // touch dispatch on RN 0.76 new arch). See context/OverlayHost.tsx +
        // tasks/lessons.md.
        <GestureHandlerRootView style={{ flex: 1 }}>
            <OverlayProvider>
                <Stack>
                    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                    <Stack.Screen name="+not-found" />
                </Stack>
            </OverlayProvider>
        </GestureHandlerRootView>
    );
}
