# SoulSync — Google Play Store Listing Package

Publisher: Raedus Labs
Package: com.raeduslabs.soulsyncapp
Public repo: https://github.com/Antimatter543/mood-tracker
Last updated: 2026-07-17

> **CANONICAL LISTING TEXT LIVES IN `fastlane/metadata/android/en-US/`**
> (`title.txt` / `short_description.txt` / `full_description.txt`) — pushed to
> Play via `gplay`. This doc is the strategy/rationale record; the 2026-07-17
> refresh moved to emoji-led, front-loaded copy (data-viz depth + open-source
> trust + privacy) and deliberately does NOT mention Health Connect (the Play
> build ships without it until Google's Health Apps declaration approves).

---

## 1. App Title (30 chars max)

Options (pick one):

| Option | Chars | Notes |
|--------|-------|-------|
| `SoulSync: Mood & Journal` | 25 | Recommended. Descriptive, hits two keywords, clean. |
| `SoulSync - Mood Tracker` | 24 | Simpler, works too. |
| `SoulSync: Private Journal` | 26 | Leans harder on privacy angle. |

**Recommended: `SoulSync: Mood & Journal`**

Reason: "Mood" and "Journal" are the two primary search terms. "SoulSync" is the brand. Play's title field is the single highest-weight ranking signal, so both keywords in the title is the right call.

---

## 2. Short Description (80 chars max)

**`Track your mood & journal privately. No account, no cloud, no ads.`**

Character count: 66. Clear benefit + three differentiators. Hits the "why should I trust this" anxiety that stops installs.

---

## 3. Full Description (4000 chars max)

```
SoulSync is a mood and journal tracker that keeps everything on your device. No account to create, no data sent to any server, no analytics, no ads. Just you and your entries.

It's also open source. The full code is on GitHub: https://github.com/Antimatter543/mood-tracker — read it, fork it, verify the privacy claims yourself.

---

WHAT YOU CAN DO

Log mood entries on a 10-point scale with optional notes, photos, and activities. The scale supports decimal precision if you want it. You can backdate entries too — caught up logging at the end of the day? No problem.

Attach photos to any entry. They stay on your device along with everything else.

Tag entries with activities (Exercise, Sleep, Work, Social, and more) or create your own with a custom icon. Drag to reorder them however you like.

---

UNDERSTAND YOUR PATTERNS

The Statistics tab shows where your mood actually goes — not where you think it goes.

- Week-over-week trend line with adaptive moving average
- Mood heatmap calendar (darker = higher mood, at a glance)
- Day-of-week breakdown: which day you reliably feel best and worst
- Mood distribution histogram
- Activity correlation: what genuinely lifts your mood vs. what doesn't

The Insights tab turns all of that into plain English. Things like "You tend to feel best on Tuesday and toughest on Sunday" or "When you log Work, your mood averages 6.8 — that's +2.0 above without it." No interpretation needed.

---

TIMELINE

Every entry lives in the Timeline tab in chronological order: mood score, activities, notes, photos. Scroll back through your own history. Edit or delete any entry.

---

REMINDERS

Set a daily reminder at whatever time works for you. Tap the notification, log your mood, done.

---

THEMES

5 built-in color themes: Dark, Light, Cherry Blossom, Midnight Blue, and Forest. Switch any time in Settings.

---

PRIVACY — THE ACTUAL DETAILS

Everything is stored in a SQLite database on your device. Photos go to on-device file storage. Nothing is synced anywhere. There is no server. There is no account. There is no analytics SDK. The app has no internet permission for user data.

You own your data fully: export it as JSON any time, or import it back. If you delete the app, all your data is gone — because it was only ever on your device.

SoulSync is open source under the GPL-3.0 license. Source code: https://github.com/Antimatter543/mood-tracker

---

No subscription. No ads. No account. Free.
```

Character count: ~1,820 (well within 4,000 limit — room to expand if needed).

---

## 4. Screenshots

### Chosen screenshots (6 total, all 1000x2000 px)

Copied to `store/screenshots/`:

| File | Source | Screen shown | Why chosen |
|------|---------|--------------|------------|
| `01-home.png` | `soulsync-21-final-home.png` | Home dashboard, light theme, live data (mood 6.0, streak, 7-day chart) | Best first impression. Light theme + real data shows the app working clearly. |
| `02-stats-heatmap.png` | `soulsync-stats.png` | Statistics tab — heatmap calendar, dark theme | Heatmap is the most visually distinctive feature. Immediately shows depth. |
| `03-stats-distribution.png` | `soulsync-02b-stats-patterns.png` | Statistics — Mood Distribution histogram, All Time view | Shows the bar chart / analytics angle. Different from screenshot 2. |
| `04-timeline.png` | `soulsync-timeline.png` | Timeline tab with two entries, notes + activities visible | Shows the journal/entry side of the app. Real notes, real activities. |
| `05-insights.png` | `soulsync-03-insights.png` | Insights tab — streak, average, "What lifts your mood" card | Shows the plain-language intelligence layer. Unique differentiator vs. basic mood apps. |
| `06-themes.png` | `soulsync-14-forest-theme-applied.png` | Settings tab with Forest theme active | Shows customization + proves "5 themes" claim isn't vaporware. Light/green palette contrasts with the dark screenshots above. |

### Resolution check

All 6 are 1000x2000 px. Play requires minimum 1080px on the long edge — these are just below at 1000px on the short edge and 2000px on the long edge. 2000px > 1080px requirement, so these PASS. Play's stated minimum is 1080px on the longest edge; at 2000px long, these are comfortably over.

### Recommended screenshot order for the listing

1. Home (light, data visible) — first thing seen
2. Stats heatmap — most visual
3. Insights — shows intelligence layer
4. Timeline — shows journal depth
5. Stats distribution — more analytics
6. Themes/Settings — customization

### Skipped screenshots and why

- `soulsync-home-clean.png` / `soulsync-home-data.png`: dark theme, mostly empty state or similar to chosen home. Less compelling than the light-theme home with live data.
- `soulsync-seeded.png`: shows DEV MODE button and "Generate 50 Sample Entries" — do NOT use in store. Exposes debug-only UI.
- Form/modal screenshots: mid-flow states, not great as standalone store shots.
- `soulsync-12-settings.png`: dark settings without a theme applied. Less interesting than forest theme.

---

## 5. Feature Graphic (1024x500 PNG)

**Generated and saved to:** `/home/astraedus/projects/soulsync/store/feature-graphic.png`

Design: dark background (#0D1117), green (#4CAF50) accent bars top and bottom, mood ring circle with "7.4 today" on the left, app name "SoulSync" large on the right with tagline "Mood & journal tracker. / Your data stays with you." and three green badge pills: "Open source", "100% private", "No account". Sub-caption: "No ads. No cloud. No tracking."

If you want to regenerate it with tweaks, the PIL script is reproducible — ask for it.

---

## 6. App Icon

**Source:** `/home/astraedus/projects/soulsync/frontend/assets/images/icon.png`

Confirmed: **1024x1024 px, RGBA**. This meets Play's hi-res icon requirement (512x512 minimum; 1024x1024 is ideal and directly uploadable). No resize needed. Upload this file as-is to the Play Console under "Store listing > App icon".

---

## 7. Category + Content Rating

**Category:** Health & Fitness

Reason: SoulSync is primarily a personal wellness tool (mood tracking, pattern recognition). Lifestyle is a reasonable alternative but Health & Fitness is the stronger home — users searching for mood trackers look there. Competitor apps in this exact category (Bearable, Daylio, Reflectly) all file under Health & Fitness.

**Content rating expectation:** Everyone (ESRB) / PEGI 3

No violence, no sexual content, no gambling, no controlled substances. Users enter their own personal notes — Play's content policy treats that as user-generated content, but the app itself has no objectionable content. Expect an "Everyone" rating from the Play questionnaire with no flag.

---

## 8. Data Safety Form

Fill this into the Play Console under "Data safety":

### Does your app collect or share any of the required user data types?

**No.** Select "No" for both "Does your app collect data?" and "Does your app share data?".

### Full checklist

```
[ ] Data collected: NONE
    The app stores all data in a local SQLite database on the user's device.
    No data is sent to any server, API, or third-party service.
    There is no analytics SDK, no crash reporting SDK, no advertising SDK.

[ ] Data shared: NONE
    No data is shared with any third party. The app has no network calls
    involving user data.

[ ] Data encrypted in transit: N/A
    No user data leaves the device, so transit encryption is not applicable.

[ ] Data deleted on request: User controls all data
    The user can export (JSON), delete individual entries, or clear all data
    in Settings > Danger Zone. Uninstalling the app removes all app data
    from the device (standard Android behavior).

[ ] Security practices:
    - Data is encrypted at rest by the device's standard Android encryption
      (if the user has device encryption enabled).
    - The app does not request unnecessary permissions.
```

### Permissions the app uses

| Permission | Why |
|-----------|-----|
| `READ_MEDIA_IMAGES` (or `READ_EXTERNAL_STORAGE` below API 33) | Reading photos the user explicitly selects to attach to an entry |
| `WRITE_EXTERNAL_STORAGE` (legacy, below API 29) | Saving photo attachments to on-device storage |
| `POST_NOTIFICATIONS` | Daily reminder notifications (user-controlled, opt-in) |
| `SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` | Scheduling daily reminder at the user's chosen time |
| `RECEIVE_BOOT_COMPLETED` | Re-arming the daily reminder after device restart |

**No internet permission. No location. No contacts. No camera direct access (images are picked via system picker).**

---

## 9. Privacy Policy

Full text in `/home/astraedus/projects/soulsync/store/privacy-policy.md`.

Included verbatim below for copy-paste into Play Console and for hosting.

### Hosting options (Play requires a public URL)

1. **GitHub Pages on the public repo** (recommended, zero cost): add `privacy-policy.md` (or an `index.html`) to `https://github.com/Antimatter543/mood-tracker` and enable GitHub Pages on the `docs/` folder or a `gh-pages` branch. The URL would be something like `https://antimatter543.github.io/mood-tracker/privacy`. This is the fastest path — one commit, done.

2. **raeduslabs.com/soulsync/privacy**: deploy via Netlify/Cloudflare Pages. More professional look if raeduslabs.com is already live. Requires a live deploy.

3. **GitHub raw file redirect**: not recommended (Play may reject raw.githubusercontent.com URLs as they serve as `text/plain`, not `text/html`). Use GitHub Pages instead.

**Do not deploy it yourself** — Anti needs to commit the privacy policy file to the public repo and either enable GitHub Pages or add it to the live site. This is a one-step task once the file text below is finalized.

---

### Privacy Policy Text (copy this into privacy-policy.md and host it)

See `/home/astraedus/projects/soulsync/store/privacy-policy.md` for the standalone file.

---

## Publish Checklist (what's left before you can click "Publish")

- [ ] Finalize and confirm app title (recommend: "SoulSync: Mood & Journal")
- [ ] Upload feature graphic (`store/feature-graphic.png`)
- [ ] Upload icon (`frontend/assets/images/icon.png`)
- [ ] Upload 6 screenshots from `store/screenshots/` in order 01-06
- [ ] Add 7-inch tablet and 10-inch tablet screenshots (Play requires these for "designed for tablets" badge — not blocking for phone-only listing, but expected)
- [ ] Host privacy policy and paste the URL into Play Console
- [ ] Fill Data Safety form (use answers in Section 8 above)
- [ ] Set category: Health & Fitness
- [ ] Complete content rating questionnaire (expect Everyone/PEGI 3)
- [ ] Set up a contact email for the listing (can be theagentthatcould@gmail.com or a dedicated support address)
- [ ] Confirm app is NOT targeting children (COPPA — this app is for general adults, select "No" for child-directed content)
- [ ] Submit for review
