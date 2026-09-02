/**
 * prerelation-js — the admissible reference class and the exact upper
 * envelope. Port of `prerelation/reference.py` (the Python reference
 * implementation), checked against the same golden vectors.
 *
 * The interior component `q` compares the rescaled interior of
 * `u = y / x` with a reference law on [0, 1]; the definition fixes that
 * reference at Uniform(0, 1). This module generalises the reference to an
 * exogenously DECLARED law `F0` and supplies:
 *
 *  - the admissible reference class
 *        B = { F0 on [0,1] : F0(t) >= t for all t in [1 - delta, 1] },
 *    references placing no more mass near the ceiling than Uniform does.
 *    Uniform meets the condition with equality (the boundary point of B).
 *    Membership is strictly weaker than first-order stochastic dominance
 *    by Uniform: Beta(2, 10) fails dominance at the floor and belongs to B.
 *
 *  - the exact upper envelope of `q` over B:
 *        sup_{F0 in B} q(F0) = 1 - D*,
 *        D* = max { (t_(i) - i/m)_+ : t_(i) >= 1 - delta }   (0 if empty),
 *    attained (for distinct t) by F0*(t) = max(ECDF_m(t), t 1{t >= 1-delta}),
 *    itself a member of B; PI_hi = A1 * ell * (1 - D*).
 *    With tied t values 1 - D* remains a valid upper bound for every member
 *    of B but need not be attained; `attained` reports which case holds.
 *
 *  - the vacuous lower end: the point mass at 0 is admissible and gives
 *    q = 1/m exactly, a function of the interior sample size alone.
 *
 *  - the family member PI(F0) = A1 * (q(F0) * ell), composed from the
 *    definition's own components (A1 and ell do not depend on F0).
 *
 * Both uses of `delta` are on the rescaled scale t: the interior is
 * u < 1 - delta, then t = u / (1 - delta), and the admissibility threshold
 * t >= 1 - delta is applied to t (equivalently u >= (1 - delta)^2).
 *
 * A reference is a callable `F0(t)` taking a number in [0, 1] and returning
 * its distribution-function value. The reference must be declared before
 * the data are seen and never fitted from the same data.
 *
 * This module depends on `core.mjs` only.
 */

import { DELTA, DENSE_MAX_N, MIN_INTERIOR, prereqIndex } from "./core.mjs";

const EPS_DEN = 1e-9; // floor of the ratio denominator (mirrors core.mjs)
const TOL = 1e-12;

// ---------------------------------------------------------------------
// reference constructors
// ---------------------------------------------------------------------

/** The package default F0(t) = t: the boundary point of B. */
export function uniformReference() {
  const F0 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  F0.referenceName = "Uniform(0,1)";
  return F0;
}

/** Degenerate law at `at`: F0(t) = 1{t >= at}. The point mass at 0 attains inf q = 1/m. */
export function pointMassReference(at = 0.0) {
  const F0 = (t) => (t >= at ? 1.0 : 0.0);
  F0.referenceName = `PointMass(${at})`;
  return F0;
}

/** Log-gamma (Lanczos, g = 7), accurate to ~1e-15 relative for x > 0. */
function logGamma(x) {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (Lentz), as in Numerical Recipes. */
function betaContinuedFraction(a, b, x) {
  const MAXIT = 300;
  const EPS = 1e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
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

/** Regularised incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const front = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (front * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Beta(a, b) distribution function as a reference callable (no dependencies). */
export function betaReference(a, b) {
  if (!(a > 0 && b > 0)) throw new RangeError("Beta parameters must be positive");
  const F0 = (t) => regularizedIncompleteBeta(a, b, t < 0 ? 0 : t > 1 ? 1 : t);
  F0.referenceName = `Beta(${a},${b})`;
  return F0;
}

// ---------------------------------------------------------------------
// the rescaled interior, exactly as core forms it
// ---------------------------------------------------------------------

function asPair(x, y) {
  const xa = Float64Array.from(x, Number);
  const ya = Float64Array.from(y, Number);
  if (xa.length !== ya.length) throw new RangeError("x and y must have equal length");
  if (xa.length === 0) throw new RangeError("empty input");
  return [xa, ya];
}

function rescaledInterior(x, y, delta) {
  const [xa, ya] = asPair(x, y);
  const n = xa.length;
  const ceilCut = 1.0 - delta;
  const interior = [];
  for (let i = 0; i < n; i++) {
    const den = xa[i] > EPS_DEN ? xa[i] : EPS_DEN;
    let r = ya[i] / den;
    if (r < 0.0) r = 0.0;
    else if (r > 1.0) r = 1.0;
    if (!(r >= ceilCut)) interior.push(r);
  }
  const t = Float64Array.from(interior, (w) => w / ceilCut).sort();
  return { t, n };
}

function guardFires(m, n) {
  return m < Math.max(MIN_INTERIOR, 0.05 * n);
}

/** ECDF of a sorted Float64Array evaluated at v: #{t_i <= v} / m. */
function ecdfSorted(t, v) {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo / t.length;
}

/**
 * The member of B that attains the supremum for this pair (distinct t):
 * F0*(t) = max(ECDF_m(t), t 1{t >= 1 - delta}).
 */
export function attainingReference(x, y, opts = {}) {
  const delta = opts.delta ?? DELTA;
  const { t } = rescaledInterior(x, y, delta);
  if (t.length === 0) throw new RangeError("no interior points");
  const lo = 1.0 - delta;
  const F0 = (v) => Math.max(ecdfSorted(t, v), v >= lo ? v : 0.0);
  F0.referenceName = "F0star";
  return F0;
}

// ---------------------------------------------------------------------
// admissibility
// ---------------------------------------------------------------------

/**
 * Does the declared reference belong to the admissible class B?
 *
 * Checks the defining pointwise condition F0(t) >= t on `nGrid` equally
 * spaced points of [1 - delta, 1] (both endpoints), NOT first-order
 * stochastic dominance: nothing is checked below 1 - delta. The tail mass
 * 1 - F0(1 - delta) is a consequence of admissibility (the condition at
 * the single point t = 1 - delta), not an equivalent restatement, so both
 * are reported.
 *
 * @returns {{admissible: boolean, tailMass: number, worstSlack: number, worstT: number}}
 */
export function admissibility(F0, opts = {}) {
  if (typeof F0 !== "function") throw new TypeError("F0 must be a function");
  const delta = opts.delta ?? DELTA;
  const nGrid = opts.nGrid ?? 2001;
  const tol = opts.tol ?? TOL;
  const lo = 1.0 - delta;
  let worstSlack = Infinity;
  let worstT = lo;
  for (let k = 0; k < nGrid; k++) {
    // numpy.linspace: lo + k * step, with the last point pinned to 1.0
    const t = k === nGrid - 1 ? 1.0 : lo + (k * (1.0 - lo)) / (nGrid - 1);
    const s = Number(F0(t)) - t;
    if (!(s >= worstSlack)) {
      worstSlack = s;
      worstT = t;
    }
  }
  const tailMass = 1.0 - Number(F0(lo));
  return { admissible: worstSlack >= -tol, tailMass, worstSlack, worstT };
}

// ---------------------------------------------------------------------
// q at a declared reference, the family member, and the envelope
// ---------------------------------------------------------------------

/**
 * The interior component q(F0) = 1 - max_i |i/m - F0(t_(i))|. With `F0`
 * omitted (Uniform) this equals `prereqIndex(x, y).q` bit for bit. Returns
 * 0 when the interior guard fires, as core does.
 */
export function interiorQ(x, y, F0 = null, opts = {}) {
  const delta = opts.delta ?? DELTA;
  const { t, n } = rescaledInterior(x, y, delta);
  const m = t.length;
  if (guardFires(m, n)) return 0.0;
  let maxDev = 0.0;
  for (let i = 0; i < m; i++) {
    const s = F0 === null ? t[i] : Number(F0(t[i]));
    const dev = Math.abs((i + 1) / m - s);
    if (dev > maxDev) maxDev = dev;
  }
  return 1.0 - maxDev;
}

/**
 * The family member PI(F0) = A1 * (q(F0) * ell), composed from the same
 * core components; at Uniform it equals `prereqIndex(x, y).PI` bit for bit.
 */
export function prereqIndexFamily(x, y, F0 = null, opts = {}) {
  const delta = opts.delta ?? DELTA;
  const denseMaxN = opts.denseMaxN ?? DENSE_MAX_N;
  const res = prereqIndex(x, y, { delta, denseMaxN });
  const q = interiorQ(x, y, F0, { delta });
  const a2 = q * res.ell;
  const reference = F0 === null ? "Uniform(0,1)" : F0.referenceName ?? "F0";
  return { PI: res.A1 * a2, A1: res.A1, A2: a2, q, ell: res.ell, reference };
}

/**
 * The exact upper envelope of the coefficient over B.
 *
 * @returns {{PI_hi, sup_q, inf_q, D_star, n_tail, m, attained, A1, ell, q, PI}}
 *   When the interior guard fires, q is 0 for every reference by definition,
 *   so sup_q = inf_q = PI_hi = 0.
 */
export function piEnvelope(x, y, opts = {}) {
  const delta = opts.delta ?? DELTA;
  const denseMaxN = opts.denseMaxN ?? DENSE_MAX_N;
  const res = prereqIndex(x, y, { delta, denseMaxN });
  const { t, n } = rescaledInterior(x, y, delta);
  const m = t.length;
  const out = { A1: res.A1, ell: res.ell, q: res.q, PI: res.PI, m };

  if (guardFires(m, n)) {
    return Object.assign(out, {
      PI_hi: 0.0, sup_q: 0.0, inf_q: 0.0, D_star: 0.0, n_tail: 0, attained: true,
    });
  }

  const lo = 1.0 - delta;
  let nTail = 0;
  let dStar = 0.0;
  for (let i = 0; i < m; i++) {
    if (t[i] >= lo) {
      nTail += 1;
      const d = t[i] - (i + 1) / m;
      const dp = d > 0.0 ? d : 0.0;
      if (dp > dStar) dStar = dp;
    }
  }
  const supQ = 1.0 - dStar;

  // Direct evaluation at the attaining reference as a FUNCTION (ties get one
  // common ECDF value), so attainment is measured rather than assumed.
  let maxDev = 0.0;
  for (let i = 0; i < m; i++) {
    const sStar = Math.max(ecdfSorted(t, t[i]), t[i] >= lo ? t[i] : 0.0);
    const dev = Math.abs((i + 1) / m - sStar);
    if (dev > maxDev) maxDev = dev;
  }
  const qStar = 1.0 - maxDev;

  return Object.assign(out, {
    PI_hi: res.A1 * res.ell * supQ,
    sup_q: supQ,
    inf_q: 1.0 / m,
    D_star: dStar,
    n_tail: nTail,
    attained: Math.abs(qStar - supQ) <= TOL,
  });
}
