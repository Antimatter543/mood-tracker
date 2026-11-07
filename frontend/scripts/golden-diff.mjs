#!/usr/bin/env node
// golden-diff.mjs: the verdict half of the golden-screenshot gate (e2e.yml).
//
// WHY IT EXISTS: jest cannot see a layout or contrast regression. A FAB that moves
// 4dp, a label that truncates, a chart area that turns into columns all keep every
// render test green. This compares the screenshots the CI emulator just took
// (scripts/e2e-goldens.sh) against the committed ones (e2e/goldens/).
//
// IT MUST FAIL CLOSED: a comparison gate that "passes" because nothing was compared
// is worse than no gate. So a missing golden, an image with no golden, a size change,
// an unreadable PNG, an unknown budget override or an empty run is a failure, never
// a skip.
//
// Usage: node scripts/golden-diff.mjs --goldens <dir> --actual <dir> --out <dir>
//                                     [--budgets <file>] [--configs a,b]
//   <dir> layout: <dir>/<config>/<name>.png. --goldens may also be another recording,
//   which is how cross-host stability is measured (--no-fail reports without failing).
// Exit:  0 all within budget, 1 any miss, 2 bad usage or an unreadable input.
// Output in --out: results.json, summary.md, and expected/actual/delta PNGs per miss.
//
// Its tests: scripts/test-golden-diff.mjs (device-free, in the PR gate). Change one,
// run the other. NEVER record goldens on a laptop: a different renderer means a
// different image. Goldens come from CI only.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// threshold 0 + includeAA: any pixel that changed at all counts. pixelmatch's
// defaults (0.1, AA ignored) are built for tolerating noise, and the renderer here is
// software (swiftshader), so there should be no noise to tolerate. A subtle contrast
// change (a colour token nudged by a few levels) must register. If cross-host noise
// ever appears, fix its source; do not widen this (see CLAUDE.md "Golden screenshots").
const PIXELMATCH_OPTIONS = { threshold: 0, includeAA: true };

function parseArgs(argv) {
  const args = { noFail: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--no-fail') { args.noFail = true; continue; }
    if (!['--goldens', '--actual', '--out', '--budgets', '--configs'].includes(key)) {
      throw new Error(`unknown argument: ${key}`);
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${key} needs a value`);
    args[key.slice(2)] = value;
  }
  for (const key of ['goldens', 'actual', 'out']) {
    if (!args[key]) throw new Error(`--${key} is required`);
  }
  return args;
}

/**
 * budgets.json. Everything in it is read strictly: a typo'd key is an error, so a
 * budget or crop that looks applied always is.
 *   defaultBudgetPct  share of the compared pixels that may differ (0.1 = 0.1%)
 *   frameHeight       full-frame screenshots are this tall; only those are cropped
 *   crop              { <config>: { top: <px> } } status bar height per device config
 *   overrides         { "<config>/<name>": <pct> } per-image budget, with a reason in
 *                     the commit that adds it. Stale keys fail (see compareAll).
 */
function loadBudgets(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const known = new Set(['defaultBudgetPct', 'frameHeight', 'crop', 'overrides']);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) throw new Error(`budgets: unknown key "${key}"`);
  }
  if (!(raw.defaultBudgetPct >= 0)) throw new Error('budgets: defaultBudgetPct must be a number >= 0');
  if (!(raw.frameHeight > 0)) throw new Error('budgets: frameHeight must be a positive number');
  return { crop: {}, overrides: {}, ...raw };
}

const listDirs = dir => (existsSync(dir)
  ? readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory()).sort()
  : []);
const listPngs = dir => (existsSync(dir)
  ? readdirSync(dir).filter(n => n.endsWith('.png')).map(n => basename(n, '.png')).sort()
  : []);

/** Copy of the image with its top `top` rows removed. */
function cropTop(png, top) {
  if (top <= 0) return png;
  if (top >= png.height) throw new Error(`crop of ${top}px leaves nothing of a ${png.height}px image`);
  const out = new PNG({ width: png.width, height: png.height - top });
  png.data.copy(out.data, 0, top * png.width * 4);
  return out;
}

/**
 * Status bars hold state we do not own (a wifi "!" that comes and goes), so they
 * are cropped. An element shot (`cropOn`) contains no status bar, and cropping it
 * would hide a real difference, so only a frame-height image is cropped.
 */
function cropFor(height, config, budgets) {
  if (height !== budgets.frameHeight) return 0;
  const top = budgets.crop[config]?.top;
  if (typeof top !== 'number') throw new Error(`budgets: no crop.${config}.top for a full-frame image`);
  return top;
}

/** Tightest box around the changed pixels, in the coordinates of the original image. */
function diffBox(a, b, cropTopPx) {
  let minX = Infinity; let minY = Infinity; let maxX = -1; let maxY = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1]
        || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : `${minX},${minY + cropTopPx} to ${maxX},${maxY + cropTopPx}`;
}

const writePng = (path, png) => writeFileSync(path, PNG.sync.write(png));

function compareOne(config, name, goldenPath, actualPath, budgets, outDir) {
  const key = `${config}/${name}`;
  const row = { key, config, name };
  let golden;
  let actual;
  try {
    golden = PNG.sync.read(readFileSync(goldenPath));
    actual = PNG.sync.read(readFileSync(actualPath));
  } catch (e) {
    return { ...row, status: 'unreadable', detail: e.message };
  }
  const missDir = join(outDir, config);
  const saveMiss = delta => {
    mkdirSync(missDir, { recursive: true });
    writeFileSync(join(missDir, `${name}.expected.png`), readFileSync(goldenPath));
    writeFileSync(join(missDir, `${name}.actual.png`), readFileSync(actualPath));
    if (delta) writePng(join(missDir, `${name}.delta.png`), delta);
  };
  if (golden.width !== actual.width || golden.height !== actual.height) {
    saveMiss(null);
    return {
      ...row,
      status: 'size-mismatch',
      detail: `golden ${golden.width}x${golden.height}, actual ${actual.width}x${actual.height}`,
    };
  }
  const top = cropFor(golden.height, config, budgets);
  const a = cropTop(golden, top);
  const b = cropTop(actual, top);
  const delta = new PNG({ width: a.width, height: a.height });
  const diffPx = pixelmatch(a.data, b.data, delta.data, a.width, a.height, PIXELMATCH_OPTIONS);
  const totalPx = a.width * a.height;
  const budgetPct = budgets.overrides[key] ?? budgets.defaultBudgetPct;
  const budgetPx = Math.floor(totalPx * budgetPct / 100);
  const out = {
    ...row,
    diffPx,
    totalPx,
    diffPct: Number((diffPx / totalPx * 100).toFixed(4)),
    budgetPct,
    budgetPx,
    cropTop: top,
    box: diffPx > 0 ? diffBox(a, b, top) : null,
    status: diffPx > budgetPx ? 'over-budget' : 'ok',
  };
  if (out.status !== 'ok') saveMiss(delta);
  return out;
}

function compareAll(args, budgets) {
  // The union, so a config only one side has is reported as a pile of missing or
  // extra images rather than being skipped.
  const wanted = args.configs
    ? args.configs.split(',').map(s => s.trim()).filter(Boolean)
    : [...new Set([...listDirs(args.goldens), ...listDirs(args.actual)])];
  const rows = [];
  for (const config of wanted) {
    const goldenDir = join(args.goldens, config);
    const actualDir = join(args.actual, config);
    const goldens = listPngs(goldenDir);
    const actuals = listPngs(actualDir);
    for (const name of [...new Set([...goldens, ...actuals])].sort()) {
      const key = `${config}/${name}`;
      if (!goldens.includes(name)) {
        rows.push({ key, config, name, status: 'no-golden', detail: 'taken on this run, no committed golden' });
      } else if (!actuals.includes(name)) {
        rows.push({ key, config, name, status: 'missing', detail: 'golden exists, this run did not produce it' });
      } else {
        rows.push(compareOne(config, name, join(goldenDir, `${name}.png`), join(actualDir, `${name}.png`), budgets, args.out));
      }
    }
  }
  // An override for an image nobody compares is a stale exemption waiting to hide
  // the next regression on a renamed image.
  const seen = new Set(rows.map(r => r.key));
  const staleOverrides = Object.keys(budgets.overrides).filter(k => !seen.has(k));
  return { rows, staleOverrides };
}

function summarise({ rows, staleOverrides }) {
  const misses = rows.filter(r => r.status !== 'ok');
  const passed = rows.length > 0 && misses.length === 0 && staleOverrides.length === 0;
  const lines = [
    `### Golden screenshots: ${passed ? 'PASS' : '**FAIL**'} (${rows.length - misses.length}/${rows.length} within budget)`,
    '',
    '| image | result | pixels changed | % | budget % | changed area |',
    '|---|---|---|---|---|---|',
    // Misses first, then the rest: a 3-pixel drift under budget is still reported, so
    // creeping instability is visible long before it fails anything.
    ...[...rows]
      .sort((x, y) => Number(y.status !== 'ok') - Number(x.status !== 'ok') || x.key.localeCompare(y.key))
      .map(r => (r.diffPx === undefined
        ? `| ${r.key} | **${r.status}** | | | | ${r.detail ?? ''} |`
        : `| ${r.key} | ${r.status === 'ok' ? 'ok' : `**${r.status}**`} | ${r.diffPx} | ${r.diffPct} | ${r.budgetPct} | ${r.box ?? ''} |`)),
  ];
  if (rows.length === 0) lines.push('', 'No images on either side: nothing was compared, which is a failure.');
  if (staleOverrides.length > 0) lines.push('', `Stale budget overrides (no such image): ${staleOverrides.join(', ')}`);
  if (misses.length > 0) lines.push('', 'expected / actual / delta PNGs are in the `e2e-out` artifact under `goldens/diff/`.');
  return { passed, misses: misses.length, markdown: `${lines.join('\n')}\n` };
}

function main() {
  let args;
  let budgets;
  try {
    args = parseArgs(process.argv.slice(2));
    budgets = loadBudgets(args.budgets ?? join(args.goldens, 'budgets.json'));
  } catch (e) {
    console.error(`golden-diff: ${e.message}`);
    return 2;
  }
  mkdirSync(args.out, { recursive: true });
  let result;
  try {
    result = compareAll(args, budgets);
  } catch (e) {
    const markdown = `### Golden screenshots: **FAIL**\n\n${e.message}\n`;
    writeFileSync(join(args.out, 'summary.md'), markdown);
    console.error(`golden-diff: ${e.message}`);
    return 2;
  }
  const { passed, misses, markdown } = summarise(result);
  writeFileSync(join(args.out, 'results.json'), `${JSON.stringify({ passed, ...result }, null, 2)}\n`);
  writeFileSync(join(args.out, 'summary.md'), markdown);
  process.stdout.write(markdown);
  if (passed || args.noFail) return 0;
  console.error(`golden-diff: ${misses} image(s) failed, ${result.staleOverrides.length} stale override(s)`);
  return 1;
}

process.exitCode = main();
