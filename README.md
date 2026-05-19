<p align="center">
  <img src="frontend/assets/images/banner.svg" alt="SoulSync Banner" width="100%"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Expo_SDK-52-000020?logo=expo&logoColor=white" alt="Expo SDK 52"/>
  <img src="https://img.shields.io/badge/React_Native-0.76-61DAFB?logo=react&logoColor=black" alt="React Native"/>
  <img src="https://img.shields.io/badge/platform-iOS_%7C_Android-lightgrey?logo=apple&logoColor=white" alt="Platform"/>
</p>
<p align="center">
  <img src="https://img.shields.io/badge/tests-253_passing-brightgreen?logo=vitest&logoColor=white" alt="Tests"/>
  <img src="https://img.shields.io/badge/privacy-100%25_local-22c55e?logo=shield&logoColor=white" alt="Privacy"/>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="License"/>
</p>

<p align="center">
  <strong>A privacy-first mood tracker built with React Native and Expo.</strong><br/>
  All data stays on your device. No accounts, no cloud, no tracking.
</p>

---

## Features

<table>
<tr>
<td width="50%" valign="top">

**Mood Tracking**
- 10-point scale with high/low precision modes
- Backdate entries with date/time picker
- Attach activities and notes to each entry

**Activities**
- Pre-seeded categories: Emotions, Sleep, Social, Activities, Health
- Fully customizable with icon picker (Feather, MaterialIcons, Ionicons)
- Drag-to-reorder support

</td>
<td width="50%" valign="top">

**Analytics**
- Weekly mood averages (line chart)
- Daily bar chart, heatmap, scatter/histogram
- Activity impact analysis
- Recovery pattern detection
- Calendar view with monthly overview

**Customization & Privacy**
- 5 themes: Dark, Light, Cherry Blossom, Midnight Blue, Forest
- JSON import/export for full data portability
- 100% local SQLite database

</td>
</tr>
</table>

## Screenshots

<p align="center">
  <img src="frontend/assets/images/screenshot-home.png" alt="Home" width="24%"/>
  <img src="frontend/assets/images/screenshot-stats.png" alt="Statistics" width="24%"/>
  <img src="frontend/assets/images/screenshot-timeline.png" alt="Timeline" width="24%"/>
  <img src="frontend/assets/images/screenshot-settings.png" alt="Settings" width="24%"/>
</p>

## Quick Start

```bash
git clone https://github.com/Antimatter543/mood-tracker.git
cd mood-tracker/frontend && npm install
npx expo start
```

Scan the QR code with [Expo Go](https://expo.dev/go), or press `a` / `i` for emulator.

> **Production builds** use [EAS Build](https://docs.expo.dev/build/introduction/). Update the `projectId` in `app.json` after forking.

## Tech Stack

| Layer | Technology |
|:------|:-----------|
| Framework | [React Native](https://reactnative.dev/) + [Expo](https://expo.dev/) (SDK 52) |
| Routing | [Expo Router](https://docs.expo.dev/router/introduction/) (file-based) |
| Database | [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) (local, on-device) |
| Charts | [react-native-chart-kit](https://github.com/indiespirit/react-native-chart-kit) |
| Calendar | [react-native-calendars](https://github.com/wix/react-native-calendars) |
| Language | TypeScript (strict mode) |

<details>
<summary><strong>Project Structure</strong></summary>

```
frontend/
├── app/                          # Screens (file-based routing)
│   ├── (tabs)/
│   │   ├── index.tsx             # Home dashboard
│   │   ├── timeline.tsx          # Entry history/journal
│   │   ├── stats.tsx             # Analytics & visualizations
│   │   ├── social.tsx            # Social features (planned)
│   │   └── settings.tsx          # App settings
│   └── _layout.tsx               # Root layout (DB provider, themes)
├── components/
│   ├── forms/                    # Entry form, mood selector, activity picker
│   │   └── hooks/                # useEntryDraft, useMoodScale
│   └── visualisations/           # Charts, heatmap, calendar
│       └── transforms/           # Pure data transforms (fully tested)
├── context/                      # React contexts (data, settings, timeframe)
├── databases/                    # SQLite facade, migrations, CRUD modules
│   ├── dateHelpers.ts            # Pure local-tz date math
│   └── migrations.ts             # Auto-run schema migrations
└── styles/
    └── global.ts                 # Theme definitions
```

</details>

## Testing

| Metric | Status |
|:-------|:-------|
| Test suites | 24 passing |
| Tests | **253 passing** |
| TypeScript | `strict: true`, `tsc --noEmit` clean |
| Lint | `expo lint` zero errors |
| Pre-commit | `npm run check` (typecheck + lint + tests) |

The database layer, chart transforms, form hooks, and date helpers are pure-function modules with dedicated test files.

```bash
npm test              # Run all tests
npm run check         # Full pre-commit gate
```

## Database

| Table | Purpose |
|:------|:--------|
| `entries` | Mood entries (score, notes, timestamp) |
| `activities` | User-defined activities with icons |
| `activity_groups` | Activity categories |
| `entry_activities` | Entry-activity links (many-to-many) |
| `entry_media` | Media attachments (schema exists, not yet implemented) |
| `user_settings` | Key-value settings store |

Migrations run automatically on app launch via `databases/migrations.ts`.

## Roadmap & Known Issues

**Known Issues**
- UTC date bucketing may misattribute day-of-week for late-night entries in non-UTC timezones
- Settings loader shows indefinite spinner if SQLite load fails (needs timeout/fallback)

**Planned**
- Cloud backup/sync
- Push notification reminders
- Media attachments UI
- CSV/PDF export
- AMOLED dark theme
- Social features

## Contributing

1. Fork the repo and create a feature branch
2. Make changes, then run `npm run check` (typecheck + lint + tests)
3. Open a Pull Request

**Tips:** Dev-only features appear when `__DEV__` is true. Add tabs by creating files in `app/(tabs)/`. Themes live in `styles/global.ts`. Database changes go through `databases/migrations.ts`.

## License

[GPL-3.0](LICENSE)

---

<p align="center">
  Built with care. Your data never leaves your device.
</p>
