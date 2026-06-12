# Plan: GitHub Actions release-APK lane + ship v1.2.3

## Goal
Wire a free, permanent GitHub Actions CI lane that builds a SIGNED release APK for SoulSync
(Expo CNG) on tag push, then use it to ship v1.2.3 (mood-picker overlay fix). EAS Android
free-tier build quota is exhausted until 2026-07-01; public-repo CI is free + permanent.

## Hard invariant that MUST survive
`git tag == app.json expo.version == APK versionName == GitHub release tag == asset SoulSync-<version>.apk`
Signature parity: the CI keystore MUST be the SAME cert that signed v1.2.2 (else APK can't update
over installed builds = user data loss).

## Phase 1 — Export + verify keystore (signature parity is everything)
- [ ] `eas credentials -p android` is interactive-only (no download flag). Drive pty: menu Keystore -> Download.
- [ ] Download keystore + creds (store pw, key alias, key pw) to ~/tmp-keystore/ (OUTSIDE repo).
- [ ] Download v1.2.2 release APK: `gh release download v1.2.2 -R Antimatter543/mood-tracker`.
- [ ] PARITY GATE: `keytool -list -v -keystore <ks>` SHA-256 == `keytool -printcert -jarfile SoulSync-1.2.2.apk` SHA-256. Mismatch => STOP, return blocked.

## Phase 2 — Secrets + backup
- [ ] `gh secret set -R Antimatter543/mood-tracker`: SOULSYNC_KEYSTORE_BASE64 (base64 -w0),
      SOULSYNC_KEYSTORE_PASSWORD, SOULSYNC_KEY_ALIAS, SOULSYNC_KEY_PASSWORD. Never echo values.
- [ ] Bitwarden backup: secure note "SoulSync Android release keystore". If bw locked + non-interactive
      unlock fails, SKIP + flag prominently.
- [ ] After CI proven: rm ~/tmp-keystore. Never write keystore inside repo tree.

## Phase 3 — The workflow (.github/workflows/release-apk.yml ON MAIN)
- [ ] Triggers: push tags 'v*' AND workflow_dispatch (optional `ref` input for branch QA builds).
- [ ] ubuntu-latest; permissions: contents: write.
- [ ] Steps: checkout (ref-aware) -> setup-node 22 -> setup-java 17 temurin -> npm ci (frontend/) ->
      npx expo prebuild --platform android (frontend/) -> decode keystore to $RUNNER_TEMP/release.keystore ->
      gradlew assembleRelease with -Pandroid.injected.signing.* -> locate APK -> rename SoulSync-<version>.apk
      (version from app.json).
- [ ] tag runs: idempotent gh release (view||create then upload --clobber). dispatch runs: upload artifact only.
- [ ] Secrets only via env into gradle step; no set -x, no echo.
- [ ] Commit `ci: add GitHub Actions release-APK lane (signed, EAS-quota-free)`, push main.
- [ ] DRY-RUN (no tag): gh workflow run -> watch -> download artifact -> verify (a) printcert == v1.2.2 fp,
      (b) versionName == 1.2.2, (c) size ~45-100MB + no x86 libs (unzip -l | grep lib/). Iterate til green.

## Phase 4 — Ship v1.2.3
- [ ] On main: npm run check -> replicate release.sh bump steps EXACTLY minus EAS:
      node scripts/bump-version.js patch -> commit `release: v1.2.3` -> tag v1.2.3 -> push main + tag.
- [ ] CI fires on tag -> creates release w/ SoulSync-1.2.3.apk. Watch to completion. Verify gh release view v1.2.3.

## Phase 5 — Device verification (Pixel 3 192.168.1.68:5555, PIN 1337, com.raeduslabs.soulsync)
- [ ] Uninstall dev-client. Install v1.2.2 RELEASE APK fresh. v1.2.2 has OLD native Modal -> can't drive
      form synthetically; just launch + Home-render check.
- [ ] adb install -r CI-built v1.2.3 OVER v1.2.2 (NO uninstall = parity + update-path proof). INSTALL_FAILED_UPDATE_INCOMPATIBLE => parity failure => blocked.
- [ ] Full synthetic add-entry flow on v1.2.3 (overlays drivable): FAB -> swipe picker -> Continue -> activity -> Submit -> entry on Home. Screenshots v123-release-* to ~/Pictures/screenshots/.
- [ ] dumpsys package | grep versionName == 1.2.3.

## Phase 6 — Close the loop
- [ ] Update CLAUDE.md Releasing section: CI lane, workflow_dispatch branch QA, secrets, keystore custody.
      Update frontend/docs/RELEASING.md. Commit docs.
- [ ] Telegram Anti.
- [ ] Final report: parity fps, secrets (names), bw done/skip, dry-run+release URLs, release+asset, device
      results+screenshots, docs commits, SDK-56 runbook note (workflow_dispatch replaces its EAS preview step).

## Decisions made
- Use `-Pandroid.injected.signing.*` gradle flags (not keystore.properties file) — cleaner for CNG
  generated android/ tree, no file to manage, secrets stay in env.
- setup-node 22 (project on node v24 locally but 22 LTS is safe + matches mission spec).
