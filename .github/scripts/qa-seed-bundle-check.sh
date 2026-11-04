#!/usr/bin/env bash
# Assert the QA seed channel (frontend/lib/qa) is ABSENT from, or PRESENT in, a
# built JS bundle (plain JS or Hermes bytecode).
#
#   qa-seed-bundle-check.sh <bundle> absent    # release APK/AAB bundles: 0 hits
#   qa-seed-bundle-check.sh <bundle> present   # EXPO_PUBLIC_QA=1 bundle: >=1 hit each
#
# It greps for BOTH strings below. lib/qa uses each at runtime (log prefix, link
# matching), so a QA bundle always carries both: that is the positive control
# that proves the grep can see them at all. Keep these literals in sync with
# frontend/lib/qa/index.ts (QA_SEED_MARKER, QA_SEED_PATH);
# frontend/__tests__/qaSeedGuard.test.ts pins that.
#
# Exit: 0 = expectation met, 1 = violated, 2 = usage error / missing bundle.
set -euo pipefail

MARKER='soulsync-qa-seed:present'
SEED_PATH='qa/seed'

if [ "$#" -ne 2 ] || { [ "$2" != absent ] && [ "$2" != present ]; }; then
  echo "usage: $0 <bundle> absent|present" >&2
  exit 2
fi
BUNDLE="$1"
EXPECT="$2"

if [ ! -s "$BUNDLE" ]; then
  echo "::error::QA seed check: bundle missing or empty: $BUNDLE" >&2
  exit 2
fi

# `strings` reads the literal table out of Hermes bytecode and is a no-op
# filter on plain JS. `grep -c` exits 1 on zero matches, hence `|| true`.
count() { strings -n 4 "$BUNDLE" | grep -F -c -- "$1" || true; }

MARKER_HITS="$(count "$MARKER")"
PATH_HITS="$(count "$SEED_PATH")"
echo "QA seed check ($EXPECT): $BUNDLE marker=$MARKER_HITS path=$PATH_HITS"

if [ "$EXPECT" = absent ]; then
  if [ "$MARKER_HITS" -ne 0 ] || [ "$PATH_HITS" -ne 0 ]; then
    echo "::error::QA seed channel found in a bundle that must not contain it ($BUNDLE): marker=$MARKER_HITS path=$PATH_HITS. The EXPO_PUBLIC_QA guard in frontend/app/_layout.tsx is not being folded away." >&2
    exit 1
  fi
else
  if [ "$MARKER_HITS" -lt 1 ] || [ "$PATH_HITS" -lt 1 ]; then
    echo "::error::QA seed channel missing from the QA bundle ($BUNDLE): marker=$MARKER_HITS path=$PATH_HITS. The positive control failed, so an 'absent' result proves nothing." >&2
    exit 1
  fi
fi
echo "QA seed check ($EXPECT): OK"
