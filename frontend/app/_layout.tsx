import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
    return (
        // RNGH needs a GestureHandlerRootView at the app root for touch/gesture
        // delivery (react-navigation / react-native-screens use it transitively).
        // The OverlayProvider (our in-tree native-<Modal> replacement) lives in
        // (tabs)/_layout.tsx INSIDE the SQLite/Data/Settings providers, since the
        // overlays it hosts (the entry form, the settings dropdown) consume those
        // contexts. See context/OverlayHost.tsx + tasks/lessons.md.
        <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="+not-found" />
            </Stack>
        </GestureHandlerRootView>
    );
}
