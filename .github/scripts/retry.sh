#!/usr/bin/env bash
# .github/scripts/retry.sh
#
# Exponential-backoff retry for an idempotent shell FUNCTION.
#
# WHY THIS EXISTS: the release job spends 30-55 minutes building and signing two
# artifacts, then finishes with a couple of one-shot `gh release` API calls. The
# GitHub REST API intermittently returns transient 5xx ("error checking for
# existing release: HTTP 503"), and with no retry that momentary blip fails the
# ENTIRE run after every expensive step already succeeded. Exactly that sank a
# docs-only Nudge release run (29710052363, 2026-07-20); SoulSync carried the same
# un-retried publish steps until this was ported across.
#
# Usage:
#   source "$GITHUB_WORKSPACE/.github/scripts/retry.sh"
#   my_idempotent_unit() { ...; }
#   retry_with_backoff 5 10 my_idempotent_unit "GitHub Release publish"
#
# The retried function MUST be idempotent — it is re-executed from the top, so it
# has to tolerate the partial state a previous failed attempt may have left.
#
# NOTE ON `set -e`: a function invoked as the condition of `until` runs with
# errexit suspended, so an inner command failing returns control to this loop
# instead of aborting the step. That is intentional; it is what lets us see the
# failure and retry it.

retry_with_backoff() {
  local max_attempts="$1"
  local delay="$2"
  local fn="$3"
  local label="${4:-$3}"
  local attempt=1

  until "$fn"; do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "::error::${label} failed after ${max_attempts} attempts"
      return 1
    fi
    echo "${label} attempt ${attempt}/${max_attempts} failed (likely a transient GitHub API error); retrying in ${delay}s..."
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done

  echo "${label} succeeded on attempt ${attempt}."
}
