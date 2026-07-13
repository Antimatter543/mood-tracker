# SoulSync v2.5.0 — Dedicated resting HR (Fitbit fix) + nerdy correlation stats

Follow-up to v2.4.0, from Anti's on-device testing with his Fitbit:
> "the sleep worked great! but resting hr and average hr aren't working; it only got
> the most recent number? ... please read documentation and figure out the issue ...
> also please add a view for HRV .... And also; I'd love to see some numbers along
> with these stats too like correlation numbers or p value.. it'd be cool/nerdy to see"

## The bug (root cause — researched, not guessed)
Fitbit does **not** write intraday/continuous `HeartRate` records to Health Connect —
only a dedicated **daily `RestingHeartRate` record** (Fitbit's intraday HR is gated
behind an unapproved Partner API; this is a documented, widely-reported Fitbit
limitation). v2.4.0 read only the `HeartRate` type and derived "resting HR" as
`minBpm` of the near-empty intraday samples, so both avg + resting HR collapsed to a
single recent sample. The dedicated `RestingHeartRate` record type — which Fitbit
populates ~1/day — was never read. Secondary bug: the resting-HR card was gated on
`hasHeartRateData` (intraday avg HR), so real resting data still wouldn't render.

`react-native-health-connect@3.5.3` exposes `RestingHeartRate` as a read record type:
`RestingHeartRateRecord extends InstantaneousRecord { recordType, time, beatsPerMinute }`.

## Fix (WS-A — data layer)
- Read the dedicated `RestingHeartRate` record (OPTIONAL perm, like HRV — not part of
  the connected gate). Cheap (~1/day), existing `readAllPages` pagination handles it.
- Store `resting_heart_rate REAL` (migration **v9**, `DATABASE_VERSION` 8→9). Day value
  = mean of that day's dedicated resting readings.
- `restingHeartRateMoodCorrelation` + overlay "Resting HR" now extract
  `restingHeartRate ?? minHeartRate` (real value preferred, intraday-min proxy fallback
  for devices that only write intraday HR).
- Gate the resting-HR card on its OWN data (`restingHeartRate ?? minHeartRate`),
  independent of avg HR. Avg HR stays honest — only shows when a device shares intraday
  HR (Fitbit won't, and we don't fake a number).

## Nerdy stats (WS-B)
- New pure `transforms/correlationStats.ts`: regularized incomplete beta → two-tailed
  p-value for Pearson r via `p = I_{df/(df+t²)}(df/2, 1/2)`; `interpretStrength`,
  `significanceLabel`. Tested against known reference p-values.
- `MetricMoodResult` gains `pValue`; surfaced on all four health↔mood cards through the
  shared `MetricMoodCard` as `r = .. · p = .. · n = ..` + strength/significance +
  plain-language explainer. Renders for both directional AND flat "ok" states.

## HRV "view"
Already read + carded (HrvMoodCard) + in the mood×metric overlay. Becomes visibly
first-class once data syncs; now also carries the r/p/n stats line. No new structure
needed — the gap Anti saw was data, not a missing surface.

## Release
- Version 2.4.0 → **2.5.0** (versionCode 20500). `scripts/bump-version.js minor`.
- Play stays HELD (`.play-hold`) — Health Connect declaration still pending; this adds
  a new HC permission (`READ_RESTING_HEART_RATE`) that must join the "Health Apps"
  declaration set (Sleep + HeartRate + HRV + **RestingHeartRate**).
- Ships to GitHub (Release APK + main-latest), device-QA'd on Pixel 3 for no-crash +
  honest empty states. Populated-path verify = Anti on his Fitbit-connected Pixel 8.

## Test doctrine
Every fix ships with jest tests (unit + a node:sqlite integration test for the new
column — the expo-sqlite mock is a no-op). Full suite green before ship.
