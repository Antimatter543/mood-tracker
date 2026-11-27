# secure-window (local Expo module)

Sets Android's `FLAG_SECURE` on SoulSync's window, and nothing else. While it is
set, Android allows no screenshots and no screen recording of the app, and the
app switcher shows a blank card instead of a preview.

The app lock turns it on while an app PIN is set (with or without a distress
PIN) and off when the lock is turned off (`context/AppLock.tsx`).

## Why the app lock needs it

Android takes the app-switcher preview when the app goes to the background,
before React can draw the lock screen. Without `FLAG_SECURE` the last screen
(a note, say) stays visible in the app switcher to whoever holds the phone,
lock or not. After a distress unlock, an old preview could still show what was
just erased. A JS-only fix is not possible: React Native has no API for window
flags.

## Why our own module and not a package

We tried `expo-screen-capture` (Expo's package for this) first and removed it:

- **It crashed the app on start on Android 14+.** On every start it registers a
  screenshot *detection* callback (`Activity.registerScreenCaptureCallback`),
  which needs `DETECT_SCREEN_CAPTURE`. We had blocked that permission, so the
  app aborted with `Permission Denial: registerScreenCaptureObserver ...
  requires android.permission.DETECT_SCREEN_CAPTURE` (found by the emulator e2e,
  `scripts/e2e-app-lock.sh`, before any device got it).
- **It listens for screenshots on every start, for every user.** Android 14+:
  the callback above; older Android: an observer on the photo library. SoulSync
  never uses either. Keeping the package would mean granting
  `DETECT_SCREEN_CAPTURE` and blocking `READ_MEDIA_IMAGES` (a sensitive
  permission on Google Play) just to switch one flag.

The two other options:

- **A config plugin that sets the flag in `MainActivity`** has no runtime
  switch: screenshots would be blocked for every user, even without an app lock.
- **This module** is about 20 lines of Kotlin that only add or clear the flag.
  No callbacks, no observers, no permissions, no third-party code. The cost is
  native code we maintain ourselves; it uses only the stable Expo module API
  (`Module`, `AsyncFunction`, `OnActivityEntersForeground`) and
  `Window.addFlags` / `clearFlags`.

## How it is wired

- Expo autolinking picks up every folder under `frontend/modules/`
  (`nativeModulesDir`, default `./modules`) on prebuild; nothing to register.
- `index.ts` exports `setSecureWindow(boolean)`. It is a no-op where the native
  module is absent (Expo Go, iOS, jest) and never throws.
- The module remembers the last state and re-applies it whenever the activity
  comes to the foreground, so a recreated activity is covered too.
- The flag is changed on the UI thread (`Activity.runOnUiThread`). Calls arrive
  on the JS thread, and Android aborts the app when a window is touched from
  there; this happened on the first emulator run, on launch.

## Tests

- `__tests__/secureWindow.test.ts`: the module stays minimal (only the flag, no
  callbacks/observers/permissions) and `expo-screen-capture` is not back.
- `__tests__/appLockGate.test.tsx`: the flag is on while a PIN is set, off while
  the lock is off.
- `scripts/e2e-app-lock.sh`: reads the real window flags on the emulator
  (secure with a PIN set, not secure after turning the lock off).
