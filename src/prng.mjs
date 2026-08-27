/**
 * prerelation-js/prng — deterministic seeded pseudo-random permutations.
 *
 * Production path for `permPvalue` and `scan` when no permutation-index
 * matrix is injected. The generator is sfc32 seeded through splitmix32,
 * using 32-bit integer arithmetic only, so the stream is identical on
 * every JavaScript engine and platform.
 *
 * This stream is deliberately NOT numpy-compatible. Cross-implementation
 * p-value parity with the Python reference package is defined only through
 * injected permutation-index matrices (see `tests/golden/` in the Python
 * repository); the internal stream exists so that production runs are
 * reproducible from a recorded seed.
 */

function splitmix32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return (t ^ (t >>> 15)) >>> 0;
  };
}

/** sfc32 generator returning uint32 values. */
export function sfc32(seed) {
  const sm = splitmix32(seed);
  let a = sm();
  let b = sm();
  let c = sm();
  let d = sm();
  function next() {
    const t = (a + b + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  }
  for (let i = 0; i < 12; i++) next(); // warm-up
  return next;
}

/**
 * Unbiased bounded integer in [0, bound) by threshold rejection.
 * @param {() => number} next - uint32 source.
 * @param {number} bound - exclusive upper bound, 1 <= bound <= 2**32.
 */
function boundedInt(next, bound) {
  if (bound <= 0) throw new RangeError("bound must be positive");
  const threshold = (0x100000000 % bound) >>> 0; // 2**32 mod bound
  for (;;) {
    const r = next();
    if (r >= threshold) return r % bound;
  }
}

/**
 * Stream of permutations of 0..n-1 from one seeded generator, drawn by
 * Fisher-Yates. Each call to the returned function yields the next
 * permutation in the stream (a fresh Int32Array).
 *
 * @param {number} seed
 * @param {number} n
 * @returns {() => Int32Array}
 */
export function permutationStream(seed, n) {
  const next = sfc32(seed);
  return function () {
    const p = new Int32Array(n);
    for (let i = 0; i < n; i++) p[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const j = boundedInt(next, i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    return p;
  };
}
