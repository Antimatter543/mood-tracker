/**
 * __tests__/correlationStats.test.ts
 *
 * Exhaustive tests for the pure significance-stats layer (correlationStats.ts):
 *   - regularizedIncompleteBeta sanity (I_0=0, I_1=1, I_0.5(1,1)=0.5, monotone),
 *   - pValueTwoSided against KNOWN reference p-values (two-tailed Student-t, the
 *     same numbers scipy.stats.pearsonr / t.sf produce), plus null/perfect/
 *     monotonicity edge cases,
 *   - interpretStrength band boundaries,
 *   - significanceLabel thresholds.
 *
 * Reference p-values are asserted within absolute tolerance 5e-3 (the display
 * only ever shows 2 dp, so anything tighter is noise).
 */
import {
  regularizedIncompleteBeta,
  pValueTwoSided,
  interpretStrength,
  significanceLabel,
} from '@/components/visualisations/transforms/correlationStats';

const near = (actual: number, expected: number, tol = 5e-3) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

// ── regularizedIncompleteBeta ────────────────────────────────────────────────

describe('regularizedIncompleteBeta', () => {
  it('I_0(a,b) = 0 and I_1(a,b) = 1 at the endpoints', () => {
    expect(regularizedIncompleteBeta(0, 3, 2)).toBe(0);
    expect(regularizedIncompleteBeta(1, 3, 2)).toBe(1);
    // out-of-range clamps
    expect(regularizedIncompleteBeta(-0.3, 3, 2)).toBe(0);
    expect(regularizedIncompleteBeta(1.5, 3, 2)).toBe(1);
  });

  it('I_x(1,1) = x (the Beta(1,1)=Uniform CDF)', () => {
    expect(regularizedIncompleteBeta(0.5, 1, 1)).toBeCloseTo(0.5, 6);
    expect(regularizedIncompleteBeta(0.25, 1, 1)).toBeCloseTo(0.25, 6);
    expect(regularizedIncompleteBeta(0.9, 1, 1)).toBeCloseTo(0.9, 6);
  });

  it('I_0.5(a,a) = 0.5 by symmetry for symmetric parameters', () => {
    expect(regularizedIncompleteBeta(0.5, 2, 2)).toBeCloseTo(0.5, 6);
    expect(regularizedIncompleteBeta(0.5, 5, 5)).toBeCloseTo(0.5, 6);
    expect(regularizedIncompleteBeta(0.5, 0.5, 0.5)).toBeCloseTo(0.5, 6);
  });

  it('is monotonically increasing in x on [0,1]', () => {
    let prev = -1;
    for (let x = 0; x <= 1.00001; x += 0.05) {
      const v = regularizedIncompleteBeta(Math.min(x, 1), 3, 5);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

// ── pValueTwoSided — KNOWN reference values ──────────────────────────────────

describe('pValueTwoSided — reference two-tailed p-values', () => {
  // Values below match scipy.stats.pearsonr / 2*t.sf(|t|, df) to 3+ dp.
  it('r=0.5, n=20 → p ≈ 0.0249', () => {
    near(pValueTwoSided(0.5, 20)!, 0.0249);
  });

  it('r=0.9, n=10 → p ≈ 0.00039', () => {
    near(pValueTwoSided(0.9, 10)!, 0.00039);
  });

  it('r=0.3, n=12 → p ≈ 0.343', () => {
    near(pValueTwoSided(0.3, 12)!, 0.343);
  });

  it('r=0.0, n=15 → p = 1.0 exactly', () => {
    expect(pValueTwoSided(0.0, 15)).toBe(1);
  });

  it('r=-0.5, n=20 → p ≈ 0.0249 (sign-symmetric)', () => {
    near(pValueTwoSided(-0.5, 20)!, 0.0249);
    // exactly equal to the +r case
    expect(pValueTwoSided(-0.5, 20)).toBeCloseTo(pValueTwoSided(0.5, 20)!, 12);
  });

  it('r=0.7, n=30 → p is tiny (≈1.7e-5, well under 1e-3)', () => {
    const p = pValueTwoSided(0.7, 30)!;
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1e-3);
  });
});

describe('pValueTwoSided — edge cases', () => {
  it('returns null for n < 3 (df < 1, p undefined)', () => {
    expect(pValueTwoSided(0.5, 2)).toBeNull();
    expect(pValueTwoSided(0.9, 1)).toBeNull();
    expect(pValueTwoSided(0.9, 0)).toBeNull();
  });

  it('returns null for a non-finite r', () => {
    expect(pValueTwoSided(NaN, 20)).toBeNull();
    expect(pValueTwoSided(Infinity, 20)).toBeNull();
  });

  it('returns 0 for a perfect correlation |r| ≥ 1', () => {
    expect(pValueTwoSided(1, 10)).toBe(0);
    expect(pValueTwoSided(-1, 10)).toBe(0);
    expect(pValueTwoSided(1.0001, 10)).toBe(0);
  });

  it('is in [0,1] across a sweep of r and n', () => {
    for (const n of [3, 5, 10, 25, 100]) {
      for (let r = -0.99; r <= 0.99; r += 0.11) {
        const p = pValueTwoSided(r, n)!;
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('pValueTwoSided — monotonicity', () => {
  it('larger |r| at fixed n → smaller p', () => {
    const n = 20;
    const rs = [0.1, 0.3, 0.5, 0.7, 0.9];
    for (let i = 1; i < rs.length; i += 1) {
      expect(pValueTwoSided(rs[i], n)!).toBeLessThan(pValueTwoSided(rs[i - 1], n)!);
    }
  });

  it('larger n at fixed r → smaller p (more evidence)', () => {
    const r = 0.4;
    const ns = [6, 10, 20, 40, 80];
    for (let i = 1; i < ns.length; i += 1) {
      expect(pValueTwoSided(r, ns[i])!).toBeLessThan(pValueTwoSided(r, ns[i - 1])!);
    }
  });
});

// ── interpretStrength — band boundaries ──────────────────────────────────────

describe('interpretStrength', () => {
  it('classifies by |r| with the conventional bands', () => {
    expect(interpretStrength(0)).toBe('negligible');
    expect(interpretStrength(0.05)).toBe('negligible');
    expect(interpretStrength(0.2)).toBe('weak');
    expect(interpretStrength(0.4)).toBe('moderate');
    expect(interpretStrength(0.6)).toBe('strong');
    expect(interpretStrength(0.85)).toBe('very strong');
    expect(interpretStrength(1)).toBe('very strong');
  });

  it('is symmetric in the sign of r', () => {
    expect(interpretStrength(-0.6)).toBe('strong');
    expect(interpretStrength(-0.85)).toBe('very strong');
    expect(interpretStrength(-0.05)).toBe('negligible');
  });

  it('band edges are half-open at the lower bound', () => {
    // 0.1 is NOT negligible (band is |r| < 0.1); 0.099 is.
    expect(interpretStrength(0.099)).toBe('negligible');
    expect(interpretStrength(0.1)).toBe('weak');
    expect(interpretStrength(0.3)).toBe('moderate');
    expect(interpretStrength(0.5)).toBe('strong');
    expect(interpretStrength(0.7)).toBe('very strong');
  });
});

// ── significanceLabel — thresholds ───────────────────────────────────────────

describe('significanceLabel', () => {
  it('maps p to the exact contract strings', () => {
    expect(significanceLabel(0.005)).toBe('strong evidence');
    expect(significanceLabel(0.03)).toBe('statistically significant');
    expect(significanceLabel(0.08)).toBe('suggestive');
    expect(significanceLabel(0.4)).toBe('could be chance');
  });

  it('thresholds are half-open at the upper bound', () => {
    expect(significanceLabel(0.009)).toBe('strong evidence');
    expect(significanceLabel(0.01)).toBe('statistically significant'); // 0.01 is NOT < 0.01
    expect(significanceLabel(0.049)).toBe('statistically significant');
    expect(significanceLabel(0.05)).toBe('suggestive'); // 0.05 is NOT < 0.05
    expect(significanceLabel(0.099)).toBe('suggestive');
    expect(significanceLabel(0.1)).toBe('could be chance'); // 0.1 is NOT < 0.1
  });
});
