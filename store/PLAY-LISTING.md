# SoulSync — Google Play Store Listing Package

Publisher: Raedus Labs
Package: com.raeduslabs.soulsyncapp
Public repo: https://github.com/Antimatter543/mood-tracker
Last updated: 2026-09-04

> **CANONICAL LISTING TEXT LIVES IN `fastlane/metadata/android/en-US/`**
> (`title.txt` / `short_description.txt` / `full_description.txt`) — pushed to
> Play via `gplay`. This doc is the strategy/rationale record; the 2026-07-17
> refresh moved to emoji-led, front-loaded copy (data-viz depth + open-source
> trust + privacy) and deliberately does NOT mention Health Connect (the Play
> build ships without it until Google's Health Apps declaration approves).
>
> The 2026-09-04 refresh covered the v2.11 interactive charts (hold-to-scrub,
> full-screen Fit view, swipe-to-page through periods) and a regenerated
> 8-slide framed screenshot set produced by `store/make-soulsync-screenshots.py`.
>
> **The LIVE Play title wins over this repo, always.** On 2026-09-04 `title.txt`
> read `SoulSync Mood Tracker` while the shipped listing had been
> `SoulSync: Mood Tracker & Diary`. `gplay listings update` sets every field and
> CLEARS any you omit, so pushing the repo's copy would have silently renamed the
> app on the store. The repo was synced to the live value, not the reverse. Before
> any listing push: read the live listing first (`gplay edits create` then
> `gplay listings get`), and pass title + short + full description together.

---

## 1. App Title (30 chars max)

**SHIPPED, and this is the source of truth: `SoulSync: Mood Tracker & Diary`** (30 chars,
exactly at the cap). Verified against the live listing on 2026-09-04.

"Mood Tracker" and "Diary" are the two search terms; "SoulSync" is the brand. Play's title
field is the highest-weight ranking signal, so both keywords earn their place.

Do not change this casually. A title change resets some of the ranking signal the listing has
accumulated, and it is the field most likely to be clobbered by accident, since
`gplay listings update` clears every field you do not pass.

<details>
<summary>Options considered in the 2026-06 pre-launch pass (historical)</summary>

| Option | Chars | Notes |
|--------|-------|-------|
| `SoulSync: Mood & Journal` | 25 | Original recommendation; superseded by the shipped title. |
| `SoulSync - Mood Tracker` | 24 | Simpler. |
| `SoulSync: Private Journal` | 26 | Leans harder on privacy. |

</details>

---

## 2. Short Description (80 chars max)

**SHIPPED: `Private mood tracker with beautiful charts & deep insights. No account. No ads.`**

79 chars. Verified against the live listing on 2026-09-04. Leads with what the app IS, then the
two objections that stop installs (account, ads). The earlier pre-launch draft
(`Track your mood & journal privately. No account, no cloud, no ads.`) was never shipped.

---

## 3. Full Description (4000 chars max)

**Do not read a copy of it here. The canonical text is
`fastlane/metadata/android/en-US/full_description.txt`** and it is the file that gets pushed.
This section used to inline the whole thing, which drifted a full rewrite behind the live
listing and is exactly the trap that nearly renamed the app (see section 1).

Structure as shipped: a one-line hook, then emoji-led sections for logging, charts, activity
deep-dives, insights, timeline, themes, privacy, and open source. Roughly 2,150 chars against
the 4,000 cap, so there is room to grow.

Two standing constraints on that file:

- **Exactly one** GitHub link. A second one reads as spam and dilutes the first.
- **No Health Connect mention** until the Play build actually ships with it. The Play AAB is
  built with `EXPO_PUBLIC_HEALTH_CONNECT=0` and Google's Health Apps declaration is still
  pending; describing a feature the shipped binary lacks is a policy problem, not just a
  copy problem.

To read what is actually live rather than what this repo believes:

```bash
EID=$(gplay edits create --package com.raeduslabs.soulsyncapp | jq -r .id)
gplay listings get --package com.raeduslabs.soulsyncapp --edit "$EID" --locale en-US --pretty
```

---

## 4. Screenshots

Regenerate the whole rail with one command. Do not hand-edit the outputs:

```bash
python3 store/make-soulsync-screenshots.py             # framed 1080x2160 Play set
python3 store/make-soulsync-screenshots.py --fastlane  # also the unframed F-Droid set
```

Inputs are the tracked raw captures in `store/screenshots/raw/`; the slide list, headline copy
and per-slide crops live in `SLIDES` at the top of that script. It verifies its own output every
run and exits non-zero naming the slide that failed.

### Shipped rail (2026-09-04, 8 slides, 1080x2160)

| # | Raw | Headline | Why it's here |
|---|-----|----------|---------------|
| 01 | `01-home.png` | Your mood, **your phone only** | First impression, and privacy is the whole pitch. |
| 02 | `02-stats-trend.png` | See patterns **you can't feel** | The hero chart. The emotional promise of the app. |
| 03 | `03-stats-scrub.png` | Hold to inspect **any day** | v2.11 headline feature; bubble shows day, avg, and the entry you wrote. |
| 04 | `04-chart-expanded-fit.png` | Zoom into **your own range** | v2.11 full-screen chart with the 0-10 / Fit toggle. |
| 05 | `05-stats-daily-bars.png` | Which day **lifts you most** | v2.11 own-drawn bars, and the only non-line chart in the rail. |
| 06 | `06-insights.png` | Insights in **plain English** | The differentiator vs. every basic mood logger. |
| 07 | `07-stats-heatmap.png` | A whole year **at a glance** | Most visually distinctive single screen. |
| 08 | `08-timeline.png` | Your whole story, **searchable** | The journal half of the app; real notes, real activities. |

Bold = the one green accent phrase per slide.

### Spares (captured, tracked, not in the rail)

Play caps the phone rail at 8, so these sit in `store/screenshots/raw/` ready to swap:

- `09-stats-swipe.png`, Statistics stepped back to `Jul 7 - Aug 5`, showing the green past-period
  range, best-streak-in-period and a red "Gently dipping" trend. Its config is in `SPARES` in the
  generator; move that entry into `SLIDES` and drop one to ship it. It was left out because the
  rail already carries three line-chart Statistics slides and a fourth reads as repetition in
  thumbnail view, while slide 05's bar chart adds variety and answers a user benefit rather than
  demonstrating a capability. Reasonable people could call this the other way.
- `10-themes.png`, Forest theme, proves the 5-themes claim.

### Rejected

- The 2026-09-04 entry-form capture. The activity picker wrapped labels mid-word
  ("Unmotivate/d", "Overwhelm/ed") and the bottom row ran under the nav bar. **That bug is now
  FIXED** (`0374bee`, activity chip labels never break inside a word), so the screen itself is no
  longer disqualified. It is simply not recaptured: the tracked raw still shows the old rendering,
  so re-shoot before using it. It is the one screen that would sell "log a day in seconds", and it
  would cost one of the eight slots.
- Anything showing DEV MODE or "Generate N Sample Entries". Debug-only UI, never ships.

**The general rule this came from: never put a screen with a visible UI defect on the store rail.**
A store screenshot is a promise about the build. If a capture shows a bug, the fix is a code lane,
not a crop.

### Specs

1080x2160 (1:2, the Pixel 3 aspect) clears Play's 1080px minimum with room. Feature graphic is
exactly 1024x500. Max 8 phone screenshots, strongest first: the first two are the only ones most
people ever see.

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
