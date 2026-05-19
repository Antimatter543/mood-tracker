# SoulSync - Mood Tracker

A privacy-first mood tracking app built with React Native and Expo. All data stays on your device — no accounts, no cloud, no tracking.

## Features

**Mood Tracking**
- 10-point mood scale with high/low precision modes
- Backdate entries with date/time picker
- Attach activities and notes to each entry

**Activity System**
- Pre-seeded categories: Emotions, Sleep, Social, Activities, Health
- Fully customizable — add, edit, delete, and reorder activities
- Icon picker with multiple icon families (Feather, MaterialIcons, Ionicons, etc.)

**Analytics & Visualizations**
- Weekly mood averages (line chart)
- Daily mood bar chart
- Custom heatmap
- Activity impact analysis
- Recovery pattern detection
- Mood scatter/histogram
- Calendar view
- Monthly overview (average mood, total entries, best day, streaks)

**Themes**
- Dark, Light, Cherry Blossom, Midnight Blue, Forest

**Data Management**
- Export data to JSON
- Import data from JSON
- Full local SQLite database — no server required

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [React Native](https://reactnative.dev/) + [Expo](https://expo.dev/) (SDK 52) |
| Routing | [Expo Router](https://docs.expo.dev/router/introduction/) (file-based) |
| Database | [SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) (local, on-device) |
| Charts | [react-native-chart-kit](https://github.com/indiespirit/react-native-chart-kit) |
| Calendar | [react-native-calendars](https://github.com/wix/react-native-calendars) |
| Language | TypeScript (strict mode) |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- Android Studio (for Android) or Xcode (for iOS)
- Or just [Expo Go](https://expo.dev/go) on your phone for quick testing

### Installation

```bash
# Clone the repo
git clone https://github.com/Antimatter543/mood-tracker.git
cd mood-tracker/frontend

# Install dependencies
npm install

# Start the dev server
npx expo start
```

Then scan the QR code with Expo Go, or press `a` for Android emulator / `i` for iOS simulator.

### Building for Production

This project uses [EAS Build](https://docs.expo.dev/build/introduction/). To build:

```bash
# Install EAS CLI
npm install -g eas-cli

# Log in to your Expo account
eas login

# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios
```

> **Note:** You'll need to update the `projectId` in `app.json` with your own EAS project ID after forking.

## Project Structure

```
frontend/
├── app/
│   ├── (tabs)/
│   │   ├── _layout.tsx        # Tab navigation layout
│   │   ├── index.tsx          # Home dashboard
│   │   ├── timeline.tsx       # Entry history/journal
│   │   ├── stats.tsx          # Analytics & visualizations
│   │   ├── social.tsx         # Social features (planned)
│   │   └── settings.tsx       # App settings
│   └── _layout.tsx            # Root layout (DB provider, themes)
├── components/
│   ├── forms/
│   │   ├── EntryForm.tsx          # Thin renderer over useEntryDraft
│   │   ├── MoodSelector.tsx       # Consumes useMoodScale
│   │   ├── ActivitySelector.tsx
│   │   ├── ActivityEditModal.tsx
│   │   ├── ActivityReorder.tsx
│   │   ├── DatePicker.tsx         # Local-day-stable normalisation
│   │   ├── dateHelpersStub.ts     # Re-exports databases/dateHelpers
│   │   └── hooks/
│   │       ├── useEntryDraft.ts   # Form state, validation, submit
│   │       └── useMoodScale.ts    # Mood-value snapping (low/high precision)
│   ├── visualisations/
│   │   ├── WeeklyMoodChart.tsx     # Thin renderers
│   │   ├── DailyMoodBar.tsx
│   │   ├── CustomHeatMap.tsx
│   │   ├── ActivityImpactChart.tsx
│   │   ├── RecoveryPatterns.tsx
│   │   ├── Scatterplot.tsx
│   │   ├── MoodCalendar.tsx
│   │   ├── chartUtils.ts
│   │   ├── queries.ts              # SQL with ?start, ?end params (local-tz)
│   │   └── transforms/             # Pure functions, fully tested
│   │       ├── weeklyMood.ts
│   │       ├── dailyBar.ts
│   │       ├── streak.ts           # Replaces the old recursive-CTE SQL
│   │       ├── activityImpact.ts
│   │       ├── recoveryPatterns.ts
│   │       ├── scatter.ts
│   │       ├── calendarMarkers.ts
│   │       ├── heatmap.ts
│   │       └── dateHelpers.ts      # Re-exports databases/dateHelpers
│   ├── AddEntryButton.tsx     # Floating action button
│   ├── Card.tsx               # Reusable card component
│   ├── IconPicker.tsx         # Icon selection modal
│   ├── PageContainer.tsx      # Page layout wrapper
│   ├── SettingRow.tsx         # Settings UI components
│   ├── DataManagementSection.tsx # Import/export UI
│   ├── seedData.ts            # Default activity definitions
│   ├── generateData.ts        # Sample data generator (dev)
│   └── types.ts               # Shared TypeScript types
├── context/
│   ├── DataContext.tsx         # Data refresh context
│   ├── SettingsContext.tsx     # User settings context
│   └── TimeframeContext.tsx    # Chart timeframe context
├── databases/
│   ├── database.ts            # Thin facade re-exporting the modules below
│   ├── lifecycle.ts           # initialize, reset, V1 schema/seed
│   ├── entries.ts             # Mood entry CRUD
│   ├── activities.ts          # Activity CRUD + reorder
│   ├── groups.ts              # Activity group CRUD
│   ├── user-settings.ts       # Settings table I/O
│   ├── settings.ts            # Settings registry (types/defaults)
│   ├── migrations.ts          # Schema migrations
│   ├── dateHelpers.ts         # Pure local-tz date math (used everywhere)
│   └── data-export.ts         # JSON import/export logic
├── styles/
│   └── global.ts              # Theme definitions & global styles
└── assets/
    └── images/                # App icons, splash screen
```

## Database

SoulSync uses SQLite with a migration system. The schema:

| Table | Purpose |
|-------|---------|
| `entries` | Mood entries (mood score, notes, timestamp) |
| `activities` | User-defined activities with icons |
| `activity_groups` | Activity categories |
| `entry_activities` | Links entries to activities (many-to-many) |
| `entry_media` | Media attachments (schema exists, not yet implemented) |
| `user_settings` | Key-value settings store |

Migrations run automatically on app launch. To add a new migration, add an entry to the `migrations` array in `databases/migrations.ts` with the next version number.

### Adding New Settings

1. Add the setting to `SETTINGS_REGISTRY` in `databases/settings.ts`
2. Add a type to `SettingsValues` if it's not a string
3. Add a database migration for the default value

## Known Issues

PRs welcome on any of these.

### Open

- **SQLite migration V2** uses the table-rebuild pattern (`CREATE _new`, copy rows, `DROP`, `ALTER ... RENAME`). This is the SQLite-recommended workaround for missing `DROP COLUMN` support but is more fragile than a single-statement migration. Works on every SQLite version currently shipped by Expo SDK 52.
- **Daily bucketing for users in non-UTC timezones**: query *windows* are now computed in local time, but the `GROUP BY date(date)` and `strftime('%w', date)` aggregates still bucket by UTC date. For an entry made at 11pm local on May 18 (1am UTC May 19), the timeline shows it correctly under "May 18" but `DailyMoodBar`'s day-of-week aggregate may attribute it to May 19. The complete fix is a `local_date` column populated at insert time — flagged as a follow-up because it requires a schema migration that needs device testing.
- **Settings load timing**: a quick `<ActivityIndicator/>` is shown while `SettingsContext` loads from SQLite. Subsequent renders see the loaded values. If the loader fails the indicator stays forever — needs a timeout/fallback path.

### Not yet implemented

- Social features (UI exists but non-functional)
- Media attachments (`entry_media` schema exists, no UI)
- Push notifications / reminders
- Cloud backup / sync
- CSV/PDF export
- AMOLED dark theme

## Quality bar

| Metric | State |
|---|---|
| Tests | 253 across 24 suites (`npm test`) |
| TypeScript | `strict: true`, `tsc --noEmit` clean |
| Lint | `expo lint` zero errors |
| Pre-commit | `npm run check` runs typecheck + lint + tests |

The database layer (`databases/`), all chart data transforms (`components/visualisations/transforms/`), the form hooks (`components/forms/hooks/`), and the date helpers (`databases/dateHelpers.ts`) are pure-function modules with their own test files — modifying them safely should not require booting the app.

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes
4. Run the linter: `npm run lint`
5. Commit: `git commit -m "Add my feature"`
6. Push: `git push origin feature/my-feature`
7. Open a Pull Request

### Development Tips

- Dev-only features (sample data generator, DB reset) only appear when `__DEV__` is true
- The app uses file-based routing — add a new tab by creating a file in `app/(tabs)/`
- Themes are defined in `styles/global.ts` — add new themes by extending the `themeColors` map
- Database changes always go through `databases/migrations.ts`, never edit `database.ts` schema directly

## Upgrade Roadmap

These are larger upgrades that require a maintainer with a device to test, so they're deferred until someone can validate end-to-end on hardware.

- **Expo SDK 52 → latest** — currently pinned to SDK 52. A major-SDK bump (53/54+) brings React Native upgrades and breaking changes to several Expo modules. Use `npx expo upgrade` and verify the full app on Android + iOS before merging.
- **`npm audit` advisories** — most are in build-time transitive deps (`tar`, `tmp`, `ws`, `undici`, `cacache`) reached through Expo's tooling, not in shipped code. Running `npm audit fix` is unsafe because it tries to downgrade Expo. These resolve naturally on the next SDK bump.
- **CSV/PDF export** — JSON export exists; CSV/PDF for journaling or sharing has been requested.
- **Media attachments** — the `entry_media` table exists in the schema but no UI yet.
- **Reminders / push notifications** — requested.

## License

[GPL-3.0](LICENSE)
