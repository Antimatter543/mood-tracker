# Contributing to SoulSync

Thanks for helping out! SoulSync is a privacy-first mood tracker: everything stays on the device
(SQLite + local files). No accounts, no cloud, no tracking. That's the whole point, so **PRs must not
add network calls, analytics, or trackers.**

## Dev setup

The app lives in `frontend/` (Expo SDK 56, React Native, expo-router, TypeScript).

```bash
cd frontend
npm ci
npx expo start          # then press "a", or scan the QR code with Expo Go
```

The project runs fine in Expo Go (no custom native modules), so you don't need a native build to try
your change.

## Before you open a PR

```bash
cd frontend
npx tsc --noEmit
npx jest
```

CI runs the same two checks on every PR. If you change behaviour, add or update a test with it.

## Screenshots, please!

**Screenshots or a short screen recording are hugely valuable for any visible change.** Maintainers
often review from a phone or a terminal, and a PR with screenshots gets reviewed and merged much faster.

- Show **before and after**.
- Show **both light and dark theme**.
- For layout changes, include a phone with **3-button navigation** (not just gesture nav), since
  that's where insets and bottom bars tend to break.

## Keep PRs focused

One change per PR. If your PR depends on another open PR, say so in the description.

## Small fixups

To get a PR merged faster, maintainers may push small fixup commits to your branch (typos, a failing
test, a nit). Credit stays with you.

## Questions?

Open an issue or ask in your PR. Friendly questions are always welcome.
