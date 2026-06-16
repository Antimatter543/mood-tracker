# Plan: Activity Correlation top5/worst5 + exclude

## Goal
Default the correlation chart to top-5 positive + top-5 negative activities with an expand
control, plus a reversible per-activity exclude that lets the next-strongest activity fill the slot.

## Steps
- [ ] Add pure `selectCorrelationView` + `parseExcludedActivities` + `serializeExcludedActivities`
      + `DEFAULT_TOP_N` to `transforms/activityCorrelation.ts` (ADD only, no edits to existing fns).
- [ ] Extend `__tests__/activityCorrelation.test.ts` to cover all three new functions.
- [ ] Rebuild the chart UI: load/persist excluded via getSetting/updateSetting (key
      `activity_correlation_excluded`), expand + showHidden local state, two labeled sections,
      extracted bar Row sub-component, per-row exclude control, expand/collapse + hidden-restore footer,
      all-excluded edge case.
- [ ] Gate: `npx tsc --noEmit && npx jest activityCorrelation`, then full `npx jest`.

## Decisions made
- Excluded list is chart-local state, NOT in SETTINGS_REGISTRY (would render a generic settings row).
- delta===0 -> positive bucket (matches existing `delta >= 0` color convention).
- Bucket Row sub-component reused across positive, negative, AND replaces the old single `.map`.
