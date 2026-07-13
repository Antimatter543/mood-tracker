// correlationStats.ts
//
// PURE, native-free, dependency-free significance statistics for a Pearson
// correlation. This is the "nerdy numbers" layer behind the health↔mood cards:
// given a Pearson r over n paired days we produce a two-tailed p-value plus
// plain-language strength/significance tags.
//
// EXACTNESS (no numeric integration):
//   The two-tailed p-value of a Pearson r uses the closed-form identity
//     P(|T| > t) = I_{df/(df+t²)}(df/2, 1/2),   T ~ Student-t(df=n-2)
//   where I_x(a,b) is the regularized incomplete beta function. We compute
//   I_x(a,b) with the classic Numerical-Recipes Lentz continued fraction
//   (`betacf`) plus a log-gamma (`gammln`) normaliser — the same routine every
//   stats library uses. No table lookups, no Monte-Carlo, no external deps, so
//   it runs identically on any JS engine (Hermes/JSC/node) and is exhaustively
//   unit-testable against known reference p-values.
//
// HONESTY:
//   These describe the USER'S OWN data over a handful of days — an association,
//   never a cause. Small n means a big r can still be "could be chance"; the
//   significanceLabel makes that explicit rather than hiding it.

/**
 * Natural log of the gamma function, Γ(x), for x > 0. Lanczos approximation
 * (g = 5, 6 coefficients) — the Numerical Recipes `gammln`. Accurate to ~1e-10
 * relative, which is far tighter than anything the p-value display needs.
 */
function gammln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += cof[j] / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/**
 * Continued-fraction evaluation for the regularized incomplete beta function
 * (Numerical Recipes `betacf`, modified Lentz method). Called only on the
 * fast-converging region x < (a+1)/(a+b+2); `regularizedIncompleteBeta`
 * arranges the symmetry swap so this always runs where it converges quickly.
 */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 1e-12;
  const FPMIN = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    // even step
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    // odd step
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Regularized incomplete beta function I_x(a, b) ∈ [0, 1], for a > 0, b > 0.
 *
 * I_x(a,b) is the CDF of a Beta(a,b) distribution at x, and the building block
 * for the Student-t tail (see {@link pValueTwoSided}). Implemented via the
 * Numerical-Recipes `betai`: a log-gamma normaliser times `betacf`, with the
 * `x < (a+1)/(a+b+2)` symmetry swap so the continued fraction is always
 * evaluated where it converges fastest (the upper region returns
 * `1 − <the other branch>`).
 *
 * Edge cases: x ≤ 0 → 0, x ≥ 1 → 1.
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  // Normalising factor: exp( lnΓ(a+b) − lnΓ(a) − lnΓ(b) + a·ln x + b·ln(1−x) ).
  const bt = Math.exp(
    gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x)
  );

  if (x < (a + 1) / (a + b + 2)) {
    // Lower region — continued fraction converges quickly here.
    return (bt * betacf(a, b, x)) / a;
  }
  // Upper region — evaluate the mirrored CF and complement it.
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/**
 * Two-tailed p-value for a Pearson correlation r observed over n paired points,
 * under H0: true correlation = 0. Uses the EXACT Student-t identity
 *   df = n − 2,  t² = r²·df / (1 − r²),  p = I_{df/(df+t²)}(df/2, 1/2)
 * (i.e. P(|T| > t) for T ~ t(df)). No numeric integration.
 *
 * @returns
 *   - `null` when n < 3 (df < 1 — a p-value is undefined) or r is non-finite.
 *   - `0` when |r| ≥ 1 (a perfect correlation; p ≈ 0).
 *   - otherwise the p-value, clamped to [0, 1].
 */
export function pValueTwoSided(r: number, n: number): number | null {
  if (n < 3 || !Number.isFinite(r)) return null;
  if (Math.abs(r) >= 1) return 0;

  const df = n - 2;
  const t2 = (r * r * df) / (1 - r * r);
  const x = df / (df + t2);
  const p = regularizedIncompleteBeta(x, df / 2, 0.5);
  return Math.max(0, Math.min(1, p));
}

/** Qualitative strength of a correlation, from its magnitude alone. */
export type CorrelationStrength =
  | 'negligible'
  | 'weak'
  | 'moderate'
  | 'strong'
  | 'very strong';

/**
 * Plain-language strength of a correlation from |r|, using the conventional
 * bands: <0.1 negligible, <0.3 weak, <0.5 moderate, <0.7 strong, else very
 * strong. Describes magnitude only — pair it with {@link significanceLabel}
 * (a big r over few days can still be "could be chance").
 */
export function interpretStrength(r: number): CorrelationStrength {
  const abs = Math.abs(r);
  if (abs < 0.1) return 'negligible';
  if (abs < 0.3) return 'weak';
  if (abs < 0.5) return 'moderate';
  if (abs < 0.7) return 'strong';
  return 'very strong';
}

/**
 * Plain-language significance tag for a p-value:
 *   p < 0.01 → 'strong evidence'
 *   p < 0.05 → 'statistically significant'
 *   p < 0.1  → 'suggestive'
 *   else     → 'could be chance'
 * (Exact strings are part of the contract — the UI and tests rely on them.)
 */
export function significanceLabel(p: number): string {
  if (p < 0.01) return 'strong evidence';
  if (p < 0.05) return 'statistically significant';
  if (p < 0.1) return 'suggestive';
  return 'could be chance';
}
