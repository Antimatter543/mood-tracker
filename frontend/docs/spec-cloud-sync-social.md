# Spec: Optional Cloud Sync + Social (Friends' Moods)

**Status: PARKED — design approved, build gated on triggers (see bottom).**
Written 2026-06-13 after Anti's prompt ("neon + clerk optional signup… optional sync… add friends and see each other's moods with chosen detail level… social timeline — worth doing as a free app?").

## Context & constraints

- SoulSync's brand promise is **"100% local, no account, no cloud, no tracking."** That line is the app's
  best store hook. Everything below must be strictly **opt-in**, with local-only remaining the default
  forever. The honest store copy after shipping any of this: *"100% local by default. Optional encrypted
  cloud backup & friends if you want them."*
- Mood data is health-adjacent. No analytics on it, ever. Server access locked down with RLS; E2E
  encryption for backup payloads is a stretch goal (see Open Questions).
- The app is currently free + sideloaded (GitHub releases). A backend that costs attention forever attached
  to a $0 product fails the "does this keep earning if we stop touching it" test — hence the gates.

## Stack decision: Supabase, NOT Neon + Clerk

The Neon + Clerk recipe we validated (piano project, `~/.claude/context/neon-clerk-nextjs-setup.md`) is
web-shaped: Clerk's Expo SDK is fine, but Neon is a bare Postgres — a mobile client can't talk to it
directly, so we'd have to build and host an API layer just to mediate. Supabase is the house canonical
mobile stack (Expo + RevenueCat + Supabase) and collapses auth + Postgres + row-level security + storage
(photo files!) + realtime into one service the app talks to directly. Free tier is fine for the foreseeable
scale. Reference security patterns: Origo's `supabase/functions/_shared/` (JWT validation server-side, no
trusting client user_ids).

## Tiers (strictly ordered — each gates the next)

### Tier 0 — Polished export/restore (NO backend; can ship in any batch)
Kills most of the "I'll lose my data" anxiety that makes people want accounts, for ~a day of work.
- One-tap **Backup**: bundle SQLite rows (entries, activities, groups, entry_activities, settings) +
  `entry_media/` photos into a single `.soulsync` zip; hand to the Android share sheet (user keeps it in
  Drive/wherever — their choice, zero server).
- **Restore/Import** with two modes: *replace* (fresh device) and *merge* (skip duplicate entry ids/dates).
- Builds on the existing `databases/data-export.ts`. Tests: round-trip (export → import → identical DB),
  merge-dedupe cases, photo file integrity.

### Tier 1 — Optional account + one-way cloud backup (~2–4 agent-days)
- Supabase email/OAuth sign-in, **only** reachable via Settings → "Cloud backup (optional)".
- Schema: `profiles`, `entries`, `entry_activities`, `activities`, `activity_groups`, `entry_media`
  mirrored per-user with RLS (`user_id = auth.uid()`); photos to a private Storage bucket.
- Push-only at first: local stays source of truth; "Back up now" + auto-backup-on-change toggle.
  Restore = pull-all on a fresh install. No merge logic yet — this is backup, not sync.
- Signed-out experience identical to today. Account deletion = full server purge (one RPC).

### Tier 2 — True two-way sync (the tarpit; PREMIUM feature; 1–2 agent-weeks)
- Offline-first SQLite ↔ cloud with: per-row `updated_at` + device id, last-write-wins per entry,
  tombstones for deletes, an outbox/upload queue for photos, conflict policy documented in-app.
- This is the classic paid unlock in this exact category (Daylio Premium = backup/sync). Wire RevenueCat;
  sync lives behind the subscription/lifetime entitlement. Run `/entitlement-audit` before launch.
- Do NOT attempt as a side quest. Only with Play Store distribution live (see gates).

### Tier 3 — Friends + graduated visibility + social timeline (after Tier 2 only)
- **Friend model**: request/accept by username or QR/share-code (no contact scraping, no global discovery —
  this is close-friends/couples territory, which is the validated niche).
- **Graduated disclosure (the core design, Anti's idea — keep it):** per-user default + per-friend override:
  - Level 1: mood number only (+ date)
  - Level 2: + activities
  - Level 3: + notes (likely keep OFF by default; arguably never — notes are diaries)
  - Photos: out of scope for sharing entirely (privacy floor).
- **Social timeline**: one feed page = friends' shared entries interleaved, rendered at each friendship's
  visibility level, server-side filtered (RLS view that only exposes the allowed columns — the phone of a
  friend must literally never receive more than the granted level; never filter client-side).
- Realtime nice-to-have via Supabase realtime; polling is fine at v1.
- Free feature (drives accounts + retention); sync stays the paid thing.

## Unpark triggers (build when ANY fires)
1. SoulSync ships to the **Play Store** and shows a real organic install signal → build Tier 1, then Tier 2
   as the premium tier with RevenueCat.
2. Anti wants it **for personal use with his own friends** regardless of business case → Tier 1 + Tier 3
   minimal (skip Tier 2's full sync; backup-push is enough to power a feed).
3. Tier 0 has no gate — schedule into any normal batch.

## Open questions (answer before Tier 1 starts)
- E2E encryption for backups (client-side key from passphrase): big privacy win, but kills server-side
  social filtering (Tier 3 needs plaintext mood/activities server-side). Likely answer: E2E for *backup
  blobs* (Tier 1/2), plaintext-with-RLS only for the *shared subset* a user explicitly grants (Tier 3).
- Username vs share-code identity for friend requests (lean share-code: zero discoverability, zero spam).
- Per-entry "don't share this one" flag (probably yes — one boolean column, big trust win).
