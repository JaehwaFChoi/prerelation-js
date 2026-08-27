/**
 * prerelation-js/scan — pairwise screening of a whole attribute set.
 *
 * `scan` takes an (nPersons x nAttributes) matrix of trait values on a
 * common anchored scale and returns
 *
 * - a tidy record per ordered pair with Pi, the reverse Pi, Delta and a
 *   permutation p-value;
 * - the edge set surviving Benjamini-Hochberg control of the false
 *   discovery rate;
 * - a cycle report;
 * - the transitive reduction of the edge set when it is acyclic; and
 * - the equivalence-class condensation with its quotient order (see
 *   `condense`), which is always defined even when the raw edge set has
 *   cycles — the Hasse diagram of the scan is drawn on the quotient.
 *
 * What the scan recovers is a **dominance preorder** over the attributes —
 * the ordering induced by which attributes act as ceilings on which
 * others — not a direct-prerequisite DAG. Indirect dominance produces
 * edges of its own (removed only along chains by the transitive
 * reduction), and siblings that share a common ceiling can be linked to
 * each other even though neither is a prerequisite for the other. A
 * disagreement between the recovered order and an expert-specified
 * prerequisite graph is therefore a difference between two concepts, not
 * by itself an error in either. Mutually dominating attributes (directed
 * cycles) are expected behavior of a pairwise index and are read as
 * equivalence classes of the preorder.
 */

import { DELTA, prereqIndex } from "./core.mjs";
import { permutationStream } from "./prng.mjs";

/** Benjamini-Hochberg adjusted p-values (step-up, monotonised). */
export function bhFdr(pvalues) {
  const p = Float64Array.from(pvalues);
  const m = p.length;
  if (m === 0) return [];
  const order = Array.from(p.keys()).sort((i, j) => p[i] - p[j] || i - j);
  const ranked = new Float64Array(m);
  for (let r = 0; r < m; r++) ranked[r] = (p[order[r]] * m) / (r + 1);
  for (let r = m - 2; r >= 0; r--) {
    if (ranked[r + 1] < ranked[r]) ranked[r] = ranked[r + 1];
  }
  const out = new Array(m);
  for (let r = 0; r < m; r++) {
    out[order[r]] = Math.min(1.0, Math.max(0.0, ranked[r]));
  }
  return out;
}

/** Return the directed cycles found by depth-first search (may be empty). */
export function findCycles(nodes, edges) {
  const adj = new Map(nodes.map((u) => [u, []]));
  for (const [u, v] of edges) adj.get(u).push(v);
  const colour = new Map(nodes.map((u) => [u, 0])); // 0 white, 1 grey, 2 black
  const stack = [];
  const cycles = [];

  function visit(u) {
    colour.set(u, 1);
    stack.push(u);
    for (const v of adj.get(u)) {
      if (colour.get(v) === 0) visit(v);
      else if (colour.get(v) === 1) {
        cycles.push(stack.slice(stack.indexOf(v)).concat([v]));
      }
    }
    stack.pop();
    colour.set(u, 2);
  }

  for (const u of nodes) if (colour.get(u) === 0) visit(u);
  return cycles;
}

function reachableSkipping(adj, src, dst, skipU, skipV) {
  const stack = [src];
  const seen = new Set([src]);
  while (stack.length > 0) {
    const u = stack.pop();
    for (const v of adj.get(u)) {
      if (u === skipU && v === skipV) continue;
      if (v === dst) return true;
      if (!seen.has(v)) {
        seen.add(v);
        stack.push(v);
      }
    }
  }
  return false;
}

/**
 * Transitive reduction of a directed acyclic graph. An edge is dropped
 * when the same ordering is already implied by a path of length two or
 * more. Throws if the graph has a cycle, where the reduction is not
 * unique.
 */
export function transitiveReduction(nodes, edges) {
  const cycles = findCycles(nodes, edges);
  if (cycles.length > 0) {
    throw new Error(
      "transitive reduction is only defined for acyclic graphs; " +
        `found cycle ${JSON.stringify(cycles[0])}`
    );
  }
  const adj = new Map(nodes.map((u) => [u, new Set()]));
  for (const [u, v] of edges) adj.get(u).add(v);
  const kept = [];
  for (const [u, v] of edges) {
    if (!reachableSkipping(adj, u, v, u, v)) kept.push([u, v]);
  }
  return kept;
}

/**
 * Equivalence-class condensation of a directed graph and its quotient
 * order.
 *
 * Attributes that dominate each other through a directed cycle are read as
 * one equivalence class of the dominance preorder. The condensation
 * contracts every strongly connected component (Tarjan) to a single node;
 * the resulting quotient graph is acyclic by construction, so the quotient
 * order always has a transitive reduction — the Hasse edge set on which
 * the diagram of a scan is drawn.
 *
 * @param {string[]} nodes
 * @param {Array<[string, string]>} edges
 * @returns {{
 *   classes: string[][],           // each class sorted in `nodes` order;
 *                                  // classes sorted by first member
 *   classOf: Map<string, number>,  // node -> index into classes
 *   quotientEdges: Array<[number, number]>,  // deduplicated, between
 *                                            // distinct classes
 *   hasseEdges: Array<[number, number]>      // transitive reduction of
 *                                            // the quotient DAG
 * }}
 */
export function condense(nodes, edges) {
  const adj = new Map(nodes.map((u) => [u, []]));
  for (const [u, v] of edges) adj.get(u).push(v);

  // Tarjan's strongly connected components (iterative).
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const tarjanStack = [];
  const components = [];
  let counter = 0;

  for (const start of nodes) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const u = frame[0];
      if (frame[1] === 0) {
        index.set(u, counter);
        low.set(u, counter);
        counter += 1;
        tarjanStack.push(u);
        onStack.add(u);
      }
      const neighbours = adj.get(u);
      let advanced = false;
      while (frame[1] < neighbours.length) {
        const v = neighbours[frame[1]];
        frame[1] += 1;
        if (!index.has(v)) {
          work.push([v, 0]);
          advanced = true;
          break;
        } else if (onStack.has(v)) {
          low.set(u, Math.min(low.get(u), index.get(v)));
        }
      }
      if (advanced) continue;
      if (low.get(u) === index.get(u)) {
        const comp = [];
        for (;;) {
          const w = tarjanStack.pop();
          onStack.delete(w);
          comp.push(w);
          if (w === u) break;
        }
        components.push(comp);
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(u)));
      }
    }
  }

  const nodeOrder = new Map(nodes.map((u, i) => [u, i]));
  const classes = components
    .map((comp) => comp.slice().sort((a, b) => nodeOrder.get(a) - nodeOrder.get(b)))
    .sort((a, b) => nodeOrder.get(a[0]) - nodeOrder.get(b[0]));
  const classOf = new Map();
  classes.forEach((comp, ci) => comp.forEach((u) => classOf.set(u, ci)));

  const seen = new Set();
  const quotientEdges = [];
  for (const [u, v] of edges) {
    const cu = classOf.get(u);
    const cv = classOf.get(v);
    if (cu === cv) continue;
    const key = `${cu}->${cv}`;
    if (!seen.has(key)) {
      seen.add(key);
      quotientEdges.push([cu, cv]);
    }
  }

  const classIds = classes.map((_, ci) => ci);
  const hasseEdges = transitiveReduction(classIds, quotientEdges);
  return { classes, classOf, quotientEdges, hasseEdges };
}

/**
 * Screen every ordered pair of attributes for ceiling dominance.
 *
 * The edge set (and its transitive reduction) is read as a *dominance
 * preorder* over the attributes, not as a recovered direct-prerequisite
 * DAG; see the module docstring for what separates the two.
 *
 * **Design floor on permutation replicates.** With `k` attributes there
 * are `K = k (k - 1)` ordered pairs, and the smallest attainable
 * permutation p-value is `1 / (nPerm + 1)`. For any pair to survive
 * Benjamini-Hochberg control at level `alpha` the replicate count must
 * satisfy `nPerm >= K / alpha - 1` (e.g. `K = 6`, `alpha = 0.05` requires
 * `nPerm >= 119`; `K = 56` requires `nPerm >= 1119`). Below the floor the
 * scan cannot return any edge, regardless of the data.
 *
 * @param {number[][]} thetaMatrix - rows are persons, columns attributes;
 *   values on a common anchored scale.
 * @param {object} [opts]
 * @param {number} [opts.alpha=0.05] - target FDR for BH, applied jointly
 *   to all ordered pairs.
 * @param {string[]} [opts.names] - attribute labels; defaults to A1, A2...
 * @param {number} [opts.nPerm=999] - permutation replicates per ordered
 *   pair. With the internal generator each pair gets its own stream,
 *   seeded as `seed + pairPosition` (pairPosition enumerates ordered
 *   pairs row-major, diagonal skipped), so results are reproducible and
 *   independent of the order of evaluation.
 * @param {number} [opts.seed=0]
 * @param {number} [opts.delta=0.05]
 * @param {number} [opts.minPi=0] - additional floor on Pi for an edge to
 *   be kept; 0 by default, since significance is the primary rule.
 * @param {boolean} [opts.requirePositiveDelta=true] - keep an edge only
 *   when the forward direction dominates the reverse.
 * @param {(pairPosition: number, n: number) => ArrayLike<ArrayLike<number>>}
 *   [opts.indicesProvider] - parity hook: when given, permutations for the
 *   pair at `pairPosition` are taken from the returned index matrix
 *   instead of the internal generator (`nPerm` is then that matrix's row
 *   count).
 * @param {(done: number, total: number) => void} [opts.onProgress]
 * @returns {{
 *   records: object[], edges: Array<[string, string]>,
 *   reducedEdges: Array<[string, string]> | null,
 *   cycles: string[][],
 *   equivalenceClasses: string[][],
 *   quotient: {classes: string[][], quotientEdges: Array<[number, number]>,
 *              hasseEdges: Array<[number, number]>},
 *   names: string[], alpha: number, meta: object
 * }}
 */
export function scan(thetaMatrix, opts = {}) {
  const alpha = opts.alpha ?? 0.05;
  const nPermOpt = opts.nPerm ?? 999;
  const seed = opts.seed ?? 0;
  const delta = opts.delta ?? DELTA;
  const minPi = opts.minPi ?? 0.0;
  const requirePositiveDelta = opts.requirePositiveDelta ?? true;

  const theta = thetaMatrix.map((row) => Float64Array.from(row));
  if (theta.length === 0 || theta[0].length < 2) {
    throw new RangeError("need at least two attributes and one person to scan");
  }
  const n = theta.length;
  const k = theta[0].length;
  for (const row of theta) {
    if (row.length !== k) {
      throw new RangeError("thetaMatrix rows must all have the same length");
    }
  }
  let names = opts.names ?? Array.from({ length: k }, (_, j) => `A${j + 1}`);
  names = names.slice();
  if (names.length !== k) {
    throw new RangeError("names must have one entry per attribute");
  }

  const col = (j) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = theta[i][j];
    return out;
  };
  const columns = Array.from({ length: k }, (_, j) => col(j));

  const piMatrix = Array.from({ length: k }, () => new Float64Array(k).fill(NaN));
  const compMatrix = Array.from({ length: k }, () => new Array(k).fill(null));
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i !== j) {
        const res = prereqIndex(columns[i], columns[j], { delta });
        piMatrix[i][j] = res.PI;
        compMatrix[i][j] = res;
      }
    }
  }

  const totalPairs = k * (k - 1);
  const records = [];
  let pairPosition = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      if (i === j) continue;
      const x = columns[i];
      const y = columns[j];
      const res = compMatrix[i][j];
      const obs = res.PI;

      let cnt = 0;
      let nPerm;
      const yPerm = new Float64Array(n);
      if (opts.indicesProvider != null) {
        const indices = opts.indicesProvider(pairPosition, n);
        nPerm = indices.length;
        for (let r = 0; r < nPerm; r++) {
          const row = indices[r];
          for (let t = 0; t < n; t++) yPerm[t] = y[row[t]];
          if (prereqIndex(x, yPerm, { delta }).PI >= obs) cnt += 1;
        }
      } else {
        nPerm = nPermOpt;
        const nextPerm = permutationStream(seed + pairPosition, n);
        for (let r = 0; r < nPerm; r++) {
          const row = nextPerm();
          for (let t = 0; t < n; t++) yPerm[t] = y[row[t]];
          if (prereqIndex(x, yPerm, { delta }).PI >= obs) cnt += 1;
        }
      }
      const pValue = (cnt + 1) / (nPerm + 1);

      records.push({
        source: names[i],
        target: names[j],
        pi: obs,
        pi_reverse: piMatrix[j][i],
        delta: obs - piMatrix[j][i],
        A1: res.A1,
        A2: res.A2,
        q: res.q,
        ell: res.ell,
        p_value: pValue,
        n,
        n_perm: nPerm,
      });
      pairPosition += 1;
      if (opts.onProgress) opts.onProgress(pairPosition, totalPairs);
    }
  }

  const pAdj = bhFdr(records.map((r) => r.p_value));
  const edges = [];
  records.forEach((rec, idx) => {
    rec.p_adj = pAdj[idx];
    let keep = pAdj[idx] <= alpha && rec.pi >= minPi;
    if (requirePositiveDelta) keep = keep && rec.delta > 0;
    rec.edge = keep;
    if (keep) edges.push([rec.source, rec.target]);
  });

  const cycles = findCycles(names, edges);
  const reducedEdges = cycles.length > 0 ? null : transitiveReduction(names, edges);
  const quotient = condense(names, edges);

  return {
    records,
    edges,
    reducedEdges,
    cycles,
    equivalenceClasses: quotient.classes,
    quotient,
    names,
    alpha,
    meta: { n, nPerm: nPermOpt, seed, delta },
  };
}
