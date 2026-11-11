// test-golden-diff.mjs: device-free tests for scripts/golden-diff.mjs, in the PR gate.
//
// WHY IT EXISTS: golden-diff is a gate, and a gate's bug fails OPEN: compare nothing,
// swallow an exit code, or crop away the change, and the job is green while a layout
// regression ships. Its real run costs ~20 CI minutes on a labelled PR or main, so the
// verdict logic is checked here against generated PNGs, as a black box through the CLI.
//
// Counterfactual hook: GOLDEN_DIFF_SCRIPT=<path> runs these against another copy of
// the script (one with a planted bug) to prove a test can fail.
//
// Usage: node --test scripts/test-golden-diff.mjs

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.GOLDEN_DIFF_SCRIPT ?? join(HERE, 'golden-diff.mjs');

const ROOT = mkdtempSync(join(tmpdir(), 'golden-diff-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

const W = 100;
const FRAME_H = 200;
// A 100x200 "full frame" with a 10px status bar: 19,000 compared pixels, so the
// default 0.1% budget allows 19.
const BUDGETS = { defaultBudgetPct: 0.1, frameHeight: FRAME_H, crop: { gesture: { top: 10 } } };

/** A PNG buffer of flat grey with `paint(x, y) -> true` pixels turned white. */
function png(width, height, paint = () => false) {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = paint(x, y) ? 255 : 90;
      image.data.set([v, v, v, 255], (y * width + x) * 4);
    }
  }
  return PNG.sync.write(image);
}

const FLAT = png(W, FRAME_H);
/** `n` changed pixels in rows below the status bar. */
const changedBelowBar = n => png(W, FRAME_H, (x, y) => y === 50 && x < n);

let caseNo = 0;
/** Lays out goldens + actuals, runs the CLI, returns { code, out, results, summary }. */
function run({ goldens = {}, actual = {}, budgets = BUDGETS, extraArgs = [] }) {
  const dir = join(ROOT, `case-${++caseNo}`);
  const write = (base, files) => {
    mkdirSync(base, { recursive: true });
    for (const [key, data] of Object.entries(files)) {
      mkdirSync(dirname(join(base, `${key}.png`)), { recursive: true });
      writeFileSync(join(base, `${key}.png`), data);
    }
  };
  write(join(dir, 'goldens'), goldens);
  write(join(dir, 'actual'), actual);
  if (budgets) writeFileSync(join(dir, 'goldens', 'budgets.json'), JSON.stringify(budgets));
  const out = join(dir, 'out');
  const res = spawnSync(process.execPath, [
    SCRIPT, '--goldens', join(dir, 'goldens'), '--actual', join(dir, 'actual'), '--out', out, ...extraArgs,
  ], { encoding: 'utf8' });
  const read = name => (existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : '');
  const resultsText = read('results.json');
  return {
    code: res.status,
    stderr: res.stderr,
    out,
    results: resultsText ? JSON.parse(resultsText) : null,
    summary: read('summary.md'),
  };
}

const rowOf = (r, key) => r.results.rows.find(x => x.key === key);

describe('golden-diff', () => {
  it('identical images pass, reporting 0 changed pixels', () => {
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': FLAT } });
    assert.equal(r.code, 0);
    assert.equal(rowOf(r, 'gesture/a').diffPx, 0);
    assert.match(r.summary, /PASS/);
  });

  it('a change under budget passes and is still reported', () => {
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': changedBelowBar(19) } });
    assert.equal(r.code, 0);
    assert.equal(rowOf(r, 'gesture/a').diffPx, 19);
    assert.match(r.summary, /\| gesture\/a \| ok \| 19 \|/);
  });

  it('one pixel over budget fails and writes expected, actual and delta PNGs', () => {
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': changedBelowBar(20) } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/a').status, 'over-budget');
    for (const kind of ['expected', 'actual', 'delta']) {
      const f = join(r.out, 'gesture', `a.${kind}.png`);
      assert.ok(existsSync(f), `${kind} PNG written`);
      assert.equal(PNG.sync.read(readFileSync(f)).width, W);
    }
    assert.match(r.summary, /FAIL/);
  });

  it('counts a subtle contrast change (a few levels on every pixel)', () => {
    const subtle = new PNG({ width: W, height: FRAME_H });
    subtle.data.fill(255);
    for (let i = 0; i < subtle.data.length; i += 4) subtle.data.set([93, 93, 93, 255], i);
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': PNG.sync.write(subtle) } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/a').diffPx, 19000);
  });

  it('reports where the change is, in original image coordinates', () => {
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': changedBelowBar(5) } });
    assert.equal(rowOf(r, 'gesture/a').box, '0,50 to 4,50');
  });

  it('a change only in the status bar passes, a change just below it does not', () => {
    const inBar = png(W, FRAME_H, (x, y) => y < 10);
    assert.equal(run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': inBar } }).code, 0);
    const belowBar = png(W, FRAME_H, (x, y) => y === 10);
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': belowBar } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/a').diffPx, 100);
  });

  it('never crops an element shot: its top rows are real content', () => {
    const element = png(W, 40);
    const changedTop = png(W, 40, (x, y) => y === 0);
    const r = run({ goldens: { 'gesture/card': element }, actual: { 'gesture/card': changedTop } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/card').cropTop, 0);
    assert.equal(rowOf(r, 'gesture/card').totalPx, 4000);
  });

  it('a missing actual fails: the run did not produce an image it should have', () => {
    const r = run({ goldens: { 'gesture/a': FLAT, 'gesture/b': FLAT }, actual: { 'gesture/a': FLAT } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/b').status, 'missing');
  });

  it('an image with no golden fails: a new shot is never silently unchecked', () => {
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': FLAT, 'gesture/new': FLAT } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/new').status, 'no-golden');
  });

  it('a whole config missing from the run fails, image by image', () => {
    const r = run({
      goldens: { 'gesture/a': FLAT, 'threebutton-cutout/a': FLAT },
      actual: { 'gesture/a': FLAT },
      budgets: { ...BUDGETS, crop: { ...BUDGETS.crop, 'threebutton-cutout': { top: 20 } } },
    });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'threebutton-cutout/a').status, 'missing');
  });

  it('nothing on either side fails: an empty comparison is never a pass', () => {
    const r = run({});
    assert.equal(r.code, 1);
    assert.match(r.summary, /nothing was compared/);
  });

  it('a size change fails with both PNGs saved', () => {
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': png(W, 190) } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/a').status, 'size-mismatch');
    assert.ok(existsSync(join(r.out, 'gesture', 'a.expected.png')));
    assert.ok(existsSync(join(r.out, 'gesture', 'a.actual.png')));
  });

  it('an unreadable PNG fails, it is not treated as equal', () => {
    const r = run({ goldens: { 'gesture/a': FLAT }, actual: { 'gesture/a': Buffer.from('not a png') } });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/a').status, 'unreadable');
  });

  it('a per-image override applies to that image only', () => {
    const r = run({
      goldens: { 'gesture/a': FLAT, 'gesture/b': FLAT },
      actual: { 'gesture/a': changedBelowBar(50), 'gesture/b': changedBelowBar(50) },
      budgets: { ...BUDGETS, overrides: { 'gesture/a': 1 } },
    });
    assert.equal(r.code, 1);
    assert.equal(rowOf(r, 'gesture/a').status, 'ok');
    assert.equal(rowOf(r, 'gesture/b').status, 'over-budget');
  });

  it('an override for an image that does not exist fails: it is a stale exemption', () => {
    const r = run({
      goldens: { 'gesture/a': FLAT },
      actual: { 'gesture/a': FLAT },
      budgets: { ...BUDGETS, overrides: { 'gesture/renamed': 5 } },
    });
    assert.equal(r.code, 1);
    assert.deepEqual(r.results.staleOverrides, ['gesture/renamed']);
  });

  it('a full-frame image in a config with no crop configured is an error, not an uncropped compare', () => {
    const r = run({ goldens: { 'other/a': FLAT }, actual: { 'other/a': FLAT } });
    assert.equal(r.code, 2);
    assert.match(r.summary, /no crop\.other\.top/);
  });

  it('a typo in budgets.json is an error, the budget never silently falls back', () => {
    const r = run({
      goldens: { 'gesture/a': FLAT },
      actual: { 'gesture/a': FLAT },
      budgets: { ...BUDGETS, overide: {} },
    });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown key "overide"/);
  });

  it('no budgets file, or a missing required flag, is a usage error', () => {
    assert.equal(run({ goldens: { 'gesture/a': FLAT }, budgets: null }).code, 2);
    const res = spawnSync(process.execPath, [SCRIPT, '--goldens', ROOT], { encoding: 'utf8' });
    assert.equal(res.status, 2);
  });

  it('--no-fail reports the numbers but exits 0 (for comparing two recordings)', () => {
    const r = run({
      goldens: { 'gesture/a': FLAT },
      actual: { 'gesture/a': changedBelowBar(60) },
      extraArgs: ['--no-fail'],
    });
    assert.equal(r.code, 0);
    assert.equal(rowOf(r, 'gesture/a').diffPx, 60);
    assert.equal(r.results.passed, false);
  });
});
