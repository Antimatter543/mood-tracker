import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";

export default function RootLayout() {
    return (
        // RNGH requires a GestureHandlerRootView at the app root for touch/gesture
        // delivery. Without it, gesture-driven controls (and, on the new arch,
        // touches inside <Modal>'s separate native window) go dead. Each <Modal>
        // also wraps its own content in a GestureHandlerRootView since the modal
        // renders in a window OUTSIDE this root. See tasks/lessons.md.
        <GestureHandlerRootView style={{ flex: 1 }}>
            <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="+not-found" />
            </Stack>
        </GestureHandlerRootView>
    );
}
