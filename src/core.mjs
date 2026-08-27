/**
 * prerelation-js/core — the prerelation coefficient and its direction
 * statistic, ported from the Python reference implementation
 * (prerelation 0.2.0, https://github.com/JaehwaFChoi/prerelation).
 *
 * The coefficient
 * ---------------
 * For a pair of traits reported on a common anchored scale [0, 1],
 *
 *     Pi(X -> Y) = A1 * A2
 *
 *     A1 = max(0, 1 - v / v0)   emptiness of the corner {Y > X}, measured
 *                               against the independence baseline v0
 *     A2 = q * ell              conditional freedom, censoring-aware
 *
 *     Delta = Pi(X -> Y) - Pi(Y - X).
 *
 * Anchored scales are an interpretability requirement, not a claim about
 * the measurement precision of any scoring model: on an unanchored scale
 * Pi carries no prerequisite interpretation.
 *
 * Correctness standard
 * --------------------
 * The Python package's `tests/oracle/prereq_index_v2.py` is the permanent
 * oracle; this module transcribes every branch of the definition literally
 * and the golden-vector tests pin the outputs to the published fixtures at
 * 1e-12 (exact for permutation p-values). The following are part of the
 * *definition*, not implementation detail:
 *
 * - the independence baseline is a V-statistic — the double sum runs over
 *   all n**2 ordered pairs, the diagonal i = j included;
 * - `v0 <= 1e-9` forces `A1 = 0`;
 * - fewer than `max(10, 0.05 n)` interior points forces `q = 0`;
 * - an empty top-x stratum forces `p1_top = 1` (hence `ell = 0`);
 * - the ratio is clipped to [0, 1] and its denominator floored at 1e-9.
 *
 * The defaults `delta = 0.05`, `TOP_Q = 0.8` and
 * `MIN_INTERIOR = max(10, 0.05 n)` are fixed conventions of the
 * definition. Do not expose or change them.
 */

export const DELTA = 0.05; // ceiling band width
export const TOP_Q = 0.8; // top-x quantile for the legitimacy check
export const MIN_INTERIOR = 10; // minimum interior points before freedom is credited

const EPS_DEN = 1e-9; // floor of the ratio denominator
const EPS_V0 = 1e-9; // guard on the independence baseline

// Above this sample size the baseline is accumulated by sorting instead of
// forming the n x n double sum. The two paths agree to floating-point
// rounding (they differ only in summation order); below the threshold the
// dense expression of the oracle is used verbatim. Mirrors the Python
// reference constant.
export const DENSE_MAX_N = 3000;

/** Neumaier (improved Kahan) compensated sum of a numeric array. */
function compensatedSum(arr) {
  let sum = 0.0;
  let c = 0.0;
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i];
    const t = sum + x;
    if (Math.abs(sum) >= Math.abs(x)) {
      c += sum - t + x;
    } else {
      c += x - t + sum;
    }
    sum = t;
  }
  return sum + c;
}

function asPair(x, y) {
  if (!Array.isArray(x) && !ArrayBuffer.isView(x)) {
    throw new TypeError("x must be an array of numbers");
  }
  if (!Array.isArray(y) && !ArrayBuffer.isView(y)) {
    throw new TypeError("y must be an array of numbers");
  }
  if (x.length !== y.length) {
    throw new RangeError(
      `x and y must have equal length, got ${x.length} and ${y.length}`
    );
  }
  if (x.length === 0) {
    throw new RangeError("x and y must be non-empty");
  }
  return [Float64Array.from(x), Float64Array.from(y)];
}

/**
 * Independence baseline v0 = mean over all n**2 ordered pairs of
 * (y_j - x_i)_+. The diagonal is included: a V-statistic, not a
 * U-statistic.
 */
function baselineMean(x, y, denseMaxN) {
  const n = x.length;
  if (n <= denseMaxN) {
    // Literal double sum of the oracle, with compensated accumulation.
    let sum = 0.0;
    let c = 0.0;
    for (let i = 0; i < n; i++) {
      const xi = x[i];
      for (let j = 0; j < n; j++) {
        const d = y[j] - xi;
        const term = d > 0.0 ? d : 0.0;
        const t = sum + term;
        if (Math.abs(sum) >= Math.abs(term)) {
          c += sum - t + term;
        } else {
          c += term - t + sum;
        }
        sum = t;
      }
    }
    return (sum + c) / (n * n);
  }

  // Sort-and-accumulate: for each x_i, sum_j (y_j - x_i)_+ equals the sum
  // of the y above x_i minus x_i times how many there are. O(n log n).
  const ys = Float64Array.from(y).sort();
  const tail = new Float64Array(n + 1); // tail[k] = sum(ys[k:])
  tail[n] = 0.0;
  for (let k = n - 1; k >= 0; k--) tail[k] = tail[k + 1] + ys[k];
  const inner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // count of y_j <= x_i  (searchsorted side="right")
    let lo = 0;
    let hi = n;
    const xi = x[i];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (ys[mid] <= xi) lo = mid + 1;
      else hi = mid;
    }
    inner[i] = tail[lo] - xi * (n - lo);
  }
  return compensatedSum(inner) / n / n;
}

/**
 * Quantile with linear interpolation, replicating numpy's method="linear"
 * including its half-way switch between the two lerp formulas.
 */
function quantileLinear(sorted, q) {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = lo + 1 >= n ? n - 1 : lo + 1;
  const t = pos - lo;
  const a = sorted[lo];
  const b = sorted[hi];
  const diff = b - a;
  let lerp = a + diff * t;
  if (t >= 0.5) lerp = b - diff * (1 - t);
  return lerp;
}

/**
 * Prerelation coefficient of the ordered pair (x -> y).
 *
 * @param {ArrayLike<number>} x - candidate prerequisite, values in [0, 1]
 *   on a common anchored scale.
 * @param {ArrayLike<number>} y - candidate dependent trait, same scale.
 * @param {object} [opts]
 * @param {number} [opts.delta=0.05] - ceiling band width (fixed convention).
 * @param {number} [opts.denseMaxN=3000] - sample size up to which the
 *   independence baseline is formed as the literal double sum.
 * @returns {{PI: number, A1: number, A2: number, q: number, ell: number}}
 *   Keys mirror the Python reference return interface exactly.
 *
 * The statistic is deliberately not invariant to monotone rescaling of
 * either axis, and it is not symmetric: `prereqIndex(y, x)` answers a
 * different question.
 */
export function prereqIndex(x, y, opts = {}) {
  const delta = opts.delta ?? DELTA;
  const denseMaxN = opts.denseMaxN ?? DENSE_MAX_N;
  const [xa, ya] = asPair(x, y);
  const n = xa.length;

  // A1: corner emptiness relative to the independence baseline.
  const corner = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = ya[i] - xa[i];
    corner[i] = d > 0.0 ? d : 0.0;
  }
  const v = compensatedSum(corner) / n;
  const v0 = baselineMean(xa, ya, denseMaxN);
  const a1 = v0 > EPS_V0 ? Math.max(0.0, 1.0 - v / v0) : 0.0;

  // A2: conditional freedom with a censoring-aware benchmark.
  const u = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const den = xa[i] > EPS_DEN ? xa[i] : EPS_DEN;
    let r = ya[i] / den;
    if (r < 0.0) r = 0.0;
    else if (r > 1.0) r = 1.0;
    u[i] = r;
  }
  const ceilCut = 1.0 - delta;
  const interior = [];
  const ceilMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (u[i] >= ceilCut) ceilMask[i] = 1;
    else interior.push(u[i]);
  }

  let q;
  if (interior.length < Math.max(MIN_INTERIOR, 0.05 * n)) {
    q = 0.0;
  } else {
    const t = Float64Array.from(interior, (w) => w / ceilCut).sort();
    let maxDev = 0.0;
    const m = t.length;
    for (let i = 0; i < m; i++) {
      const dev = Math.abs((i + 1) / m - t[i]);
      if (dev > maxDev) maxDev = dev;
    }
    q = 1.0 - maxDev;
  }

  const xSorted = Float64Array.from(xa).sort();
  const thr = quantileLinear(xSorted, TOP_Q);
  let nTop = 0;
  let nTopCeil = 0;
  for (let i = 0; i < n; i++) {
    if (xa[i] >= thr) {
      nTop += 1;
      if (ceilMask[i]) nTopCeil += 1;
    }
  }
  const p1Top = nTop > 0 ? nTopCeil / nTop : 1.0;
  const ell = 1.0 - Math.max(0.0, p1Top - delta) / (1.0 - delta);

  const a2 = q * ell;
  return { PI: a1 * a2, A1: a1, A2: a2, q, ell };
}

/**
 * Directional contrast of the pair.
 *
 * @returns {{delta: number, forward: number, reverse: number}} where
 *   `delta = forward - reverse`, `forward = Pi(x -> y)` and
 *   `reverse = Pi(y -> x)`.
 */
export function direction(x, y, opts = {}) {
  const forward = prereqIndex(x, y, opts).PI;
  const reverse = prereqIndex(y, x, opts).PI;
  return { delta: forward - reverse, forward, reverse };
}

/**
 * Permutation test of independence for the forward statistic.
 *
 * Under the null of independence the joint law of the sample is invariant
 * under permutations of the y-labels; the Monte-Carlo version inherits
 * validity because the observed configuration is counted in the reference
 * set (the add-one rule): p = (1 + #{r: PI_r >= PI_obs}) / (nPerm + 1).
 *
 * Two sources of permutations are supported:
 *
 * - `opts.indices`: an injected permutation-index matrix — an array of
 *   `nPerm` rows, each a permutation of `0..n-1`. This is the parity path:
 *   with the committed index matrices from the Python reference package's
 *   `tests/golden/`, the p-value must equal the published expected value
 *   exactly (it is count-based).
 * - `opts.seed` with the internal generator (see prng.mjs) for production
 *   use. The internal generator is deterministic and seeded but is NOT the
 *   same stream as numpy's; cross-implementation p-value parity is only
 *   defined through injected indices.
 *
 * @returns {{observed: number, pValue: number}}
 */
export function permPvalue(x, y, opts = {}) {
  const delta = opts.delta ?? DELTA;
  const denseMaxN = opts.denseMaxN ?? DENSE_MAX_N;
  const [xa, ya] = asPair(x, y);
  const obs = prereqIndex(xa, ya, { delta, denseMaxN }).PI;

  let cnt = 0;
  let nPerm;
  if (opts.indices != null) {
    const indices = opts.indices;
    nPerm = indices.length;
    const yPerm = new Float64Array(ya.length);
    for (let r = 0; r < nPerm; r++) {
      const row = indices[r];
      if (row.length !== ya.length) {
        throw new RangeError(
          `indices row ${r} has length ${row.length}, expected ${ya.length}`
        );
      }
      for (let i = 0; i < ya.length; i++) yPerm[i] = ya[row[i]];
      if (prereqIndex(xa, yPerm, { delta, denseMaxN }).PI >= obs) cnt += 1;
    }
  } else {
    nPerm = opts.nPerm ?? 1000;
    const seed = opts.seed ?? 0;
    // Imported lazily to keep core free of a hard dependency direction.
    const { permutationStream } = _prngModule();
    const nextPerm = permutationStream(seed, ya.length);
    const yPerm = new Float64Array(ya.length);
    for (let r = 0; r < nPerm; r++) {
      const row = nextPerm();
      for (let i = 0; i < ya.length; i++) yPerm[i] = ya[row[i]];
      if (prereqIndex(xa, yPerm, { delta, denseMaxN }).PI >= obs) cnt += 1;
    }
  }
  return { observed: obs, pValue: (cnt + 1) / (nPerm + 1) };
}

// Late-bound import so core.mjs stays loadable in isolation for the pure
// closed-form functions even if prng.mjs is absent (it never is in the
// shipped package; this only defers module resolution).
import * as _prng from "./prng.mjs";
function _prngModule() {
  return _prng;
}
