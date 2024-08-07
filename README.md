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
│   │   ├── EntryForm.tsx      # Main mood entry form
│   │   ├── MoodSelector.tsx   # Mood scale slider
│   │   ├── ActivitySelector.tsx # Activity picker
│   │   ├── ActivityEditModal.tsx # Edit/create activities
│   │   ├── ActivityReorder.tsx # Reorder activities
│   │   └── DatePicker.tsx     # Date/time selector
│   ├── visualisations/
│   │   ├── WeeklyMoodChart.tsx
│   │   ├── DailyMoodBar.tsx
│   │   ├── CustomHeatMap.tsx
│   │   ├── ActivityImpactChart.tsx
│   │   ├── RecoveryPatterns.tsx
│   │   ├── Scatterplot.tsx
│   │   ├── MoodCalendar.tsx
│   │   ├── chartUtils.ts
│   │   └── queries.ts        # Chart data queries
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
│   ├── database.ts            # Core DB operations (CRUD)
│   ├── migrations.ts          # Schema migrations
│   ├── settings.ts            # Settings registry & DB ops
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

These are known bugs and areas for improvement. PRs welcome!

### Bugs

- **SQLite migration V2**: Uses `ALTER TABLE ... DROP COLUMN` which isn't supported in all SQLite versions. Works on newer Android/iOS but may fail on older devices.
- **Missing `icon_family` in query**: `database.ts` selects `icon_name` but not `icon_family` in some activity queries, causing undefined icon families.
- **Import edge case**: If activities were deleted but `entry_activities` still references them, import silently drops those associations.
- **No null guard on chart data**: Some chart components assume data arrays are non-empty without validation.
- **Settings race condition**: Settings context could be read before initial load completes.

### Code Quality

- Heavy use of `any` type (20+ instances) — TypeScript strict mode is on but undermined
- Console.log statements in production code (should be wrapped in `__DEV__` checks)
- No tests written (Jest is configured but test coverage is 0%)
- No ESLint or Prettier config

### Not Yet Implemented

- Social features (UI exists but non-functional)
- Media attachments (DB schema exists, no UI)
- Push notifications / reminders
- Cloud backup / sync
- CSV/PDF export
- AMOLED dark theme

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

## License

[GPL-3.0](LICENSE)
