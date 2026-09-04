# Generated output. Do not write here by hand.

Every PNG under `en-US/phoneScreenshots/` is produced by
`store/make-soulsync-screenshots.py` and uploaded verbatim to the live Google Play
listing. A write into this directory reaches strangers browsing the store.

**Capturing screenshots? You want a different directory.**

| What | Where |
|---|---|
| Fresh device captures, scratch | `~/Pictures/screenshots/soulsync-store-<date>/` |
| Raw captures, tracked, the generator's INPUT | `store/screenshots/raw/` |
| Framed slides, generated OUTPUT, this directory | `store/play-screenshots/en-US/phoneScreenshots/` |

To change what ships, edit a raw in `store/screenshots/raw/` or the `SLIDES` list in
the generator, then regenerate:

```bash
python3 store/make-soulsync-screenshots.py             # framed 1080x2160 set
python3 store/make-soulsync-screenshots.py --fastlane  # also the unframed F-Droid set
python3 store/make-soulsync-screenshots.py --check-only # validate what is on disk
```

`frontend/__tests__/storeSlides.test.ts` enforces the same invariant without anyone
having to remember: it fails the jest run that `scripts/release.sh` and CI already gate
on if any PNG here is not a complete, sequentially numbered 1080x2160 slide, or is
byte-identical to a raw capture. `--check-only` stays the richer local gate (it decodes
pixels); the test is the always-on floor.

## Why this file exists

On 2026-09-04 a parallel agent wrote raw 1000x2000 device captures into this
directory, twice. One landed between a render and a Play upload, so an unframed
screenshot with no headline went live on the store page. It survived review because
the upload check compared Play's sha256 against the local file and they matched:
a single write had corrupted both sides of the comparison.

Two things came out of that, and both still hold:

- **Never verify a shipped artefact by comparing it to a local copy alone.** That
  check cannot detect any failure that touches both. `--check-only` instead asserts
  intrinsic properties: exact 1080x2160 dimensions, dark ground at the canvas edges,
  bright type in the headline band, dither intact. Run it immediately before
  uploading, not just after rendering.
- **Verify against Play by downloading the image and measuring it**, not by trusting
  the sha256 the API hands back.
