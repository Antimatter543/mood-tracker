import type { ComponentType } from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";

// QA seed channel (QA builds ONLY, see lib/qa/index.ts). Keep this EXACT shape:
// `process.env.EXPO_PUBLIC_QA === '1'` with dot access, compared inline. In a
// release build babel-preset-expo inlines the flag to `undefined`, Metro folds
// the condition to `false` and deletes the block BEFORE collecting
// dependencies, so lib/qa never enters the bundle. Destructuring the env, or
// moving the check into a helper, defeats that folding and would SHIP the
// backdoor; __tests__/qaSeedGuard.test.ts and the CI bundle grep catch both.
let QaSeedHost: ComponentType | null = null;
if (process.env.EXPO_PUBLIC_QA === '1') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    QaSeedHost = require('@/lib/qa/QaSeedHost').QaSeedHost;
}

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
            {QaSeedHost ? <QaSeedHost /> : null}
        </GestureHandlerRootView>
    );
}
