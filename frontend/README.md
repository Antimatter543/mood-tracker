# SoulSync app source

This folder holds the Expo (SDK 56) app source for SoulSync.

For the project overview, stack, install instructions, build/release docs, and
screenshots, see the [root README](../README.md) and `../CLAUDE.md`.

Quick start: `npm install`, then `npx expo start` (Metro/Expo Go for iteration).
Builds and releases go through the CI lane, never a local native build.

Note: do NOT run `npm run reset-project`. That `create-expo-app` helper wipes
the `app/` directory and would delete the real app.
