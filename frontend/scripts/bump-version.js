#!/usr/bin/env node
/**
 * Deterministic version bump for SoulSync.
 *
 * SINGLE SOURCE OF TRUTH: app.json `expo.version` (semver MAJOR.MINOR.PATCH).
 * `android.versionCode` is DERIVED, never hand-edited:
 *     versionCode = MAJOR*10000 + MINOR*100 + PATCH
 * e.g. 1.2.1 -> 10201, 1.3.0 -> 10300, 2.0.0 -> 20000.
 * This is monotonic as long as MINOR and PATCH stay <= 99, which the script
 * enforces. iOS buildNumber tracks versionCode too (kept in sync here).
 *
 * Usage: node scripts/bump-version.js <patch|minor|major>
 * Prints the new version to stdout (so a release script can capture it).
 */
const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');
const bump = (process.argv[2] || 'patch').toLowerCase();

if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`bump must be patch|minor|major (got "${bump}")`);
  process.exit(1);
}

const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
let [maj, min, pat] = String(app.expo.version).split('.').map(Number);

if (bump === 'major') { maj += 1; min = 0; pat = 0; }
else if (bump === 'minor') { min += 1; pat = 0; }
else { pat += 1; }

if (min > 99 || pat > 99) {
  console.error('minor/patch must stay <= 99 for the versionCode scheme. Do a major bump.');
  process.exit(1);
}

const version = `${maj}.${min}.${pat}`;
const versionCode = maj * 10000 + min * 100 + pat;

app.expo.version = version;
app.expo.android = app.expo.android || {};
app.expo.android.versionCode = versionCode;
app.expo.ios = app.expo.ios || {};
app.expo.ios.buildNumber = String(versionCode);

fs.writeFileSync(appJsonPath, JSON.stringify(app, null, 2) + '\n');
process.stdout.write(version);
