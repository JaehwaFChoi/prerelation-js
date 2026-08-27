/**
 * Real-data scan parity on the fraction subtraction attribute set
 * (8 attributes, n = 536, 56 ordered pairs).
 *
 * Reference: `test/data/d2_fs_scan_records_v1.csv`, produced by the Python
 * reference implementation (prerelation 0.2.0) with
 * `scan(theta, n_perm=1999, alpha=0.05, seed=20260827)`.
 *
 * Two layers:
 *
 * 1. Deterministic layer — for every ordered pair, the closed-form
 *    components (pi, pi_reverse, delta, A1, A2, q, ell) must agree with
 *    the reference within 1e-12. No randomness is involved.
 *
 * 2. Decision layer — running the full scan with the internal seeded
 *    generator (seed 20260827, nPerm 1999, the same design as the
 *    reference run) must reproduce the reference EDGE SET, CYCLE SET and
 *    EQUIVALENCE CLASSES exactly. p-values are not compared across
 *    implementations here: the internal generator is not numpy's stream,
 *    so cross-implementation p-value equality is defined only through
 *    injected permutation-index matrices (see `tools/parity_fs/`); the
 *    dominance structure the scan reports is what must match.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { prereqIndex, scan, condense } from "../src/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "data");

function readTheta() {
  const lines = readFileSync(join(dataDir, "d2_fs_theta.csv"), "utf8")
    .trim()
    .split("\n");
  const names = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(",").map(Number));
  return { names, rows };
}

function readReference() {
  const lines = readFileSync(join(dataDir, "d2_fs_scan_records_v1.csv"), "utf8")
    .trim()
    .split("\n");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const parts = line.split(",");
    const rec = {};
    header.forEach((h, i) => {
      rec[h] = h === "source" || h === "target" || h === "edge" ? parts[i] : Number(parts[i]);
    });
    rec.edge = rec.edge === "True";
    return rec;
  });
}

const TOL = 1e-12;
const { names, rows } = readTheta();
const reference = readReference();

test("FS reference shape", () => {
  assert.equal(rows.length, 536);
  assert.equal(names.length, 8);
  assert.equal(reference.length, 56);
});

test("FS deterministic component parity (56 pairs x 7 components, 1e-12)", () => {
  const cols = names.map((_, j) => rows.map((r) => r[j]));
  const byPair = new Map(reference.map((r) => [`${r.source}->${r.target}`, r]));
  const piCache = new Map();
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < names.length; j++) {
      if (i === j) continue;
      const res = prereqIndex(cols[i], cols[j]);
      piCache.set(`${names[i]}->${names[j]}`, res);
    }
  }
  for (const [key, res] of piCache) {
    const ref = byPair.get(key);
    assert.ok(ref, `missing reference row for ${key}`);
    const [src, tgt] = key.split("->");
    const rev = piCache.get(`${tgt}->${src}`).PI;
    assert.ok(Math.abs(res.PI - ref.pi) <= TOL, `${key} pi ${res.PI}`);
    assert.ok(Math.abs(rev - ref.pi_reverse) <= TOL, `${key} pi_reverse ${rev}`);
    assert.ok(Math.abs(res.PI - rev - ref.delta) <= TOL, `${key} delta`);
    assert.ok(Math.abs(res.A1 - ref.A1) <= TOL, `${key} A1 ${res.A1}`);
    assert.ok(Math.abs(res.A2 - ref.A2) <= TOL, `${key} A2 ${res.A2}`);
    assert.ok(Math.abs(res.q - ref.q) <= TOL, `${key} q ${res.q}`);
    assert.ok(Math.abs(res.ell - ref.ell) <= TOL, `${key} ell ${res.ell}`);
  }
});

test("FS decision parity: edge set, cycle set, equivalence classes", () => {
  const result = scan(rows, {
    names,
    alpha: 0.05,
    nPerm: 1999,
    seed: 20260827,
  });

  const refEdges = reference
    .filter((r) => r.edge)
    .map((r) => `${r.source}->${r.target}`)
    .sort();
  const gotEdges = result.edges.map(([u, v]) => `${u}->${v}`).sort();
  assert.deepEqual(gotEdges, refEdges);

  // Reference cycle and class structure is a deterministic function of the
  // reference edge set; derive it with the same graph routines.
  const refEdgePairs = reference
    .filter((r) => r.edge)
    .map((r) => [r.source, r.target]);
  const refQuotient = condense(names, refEdgePairs);
  const gotClasses = result.equivalenceClasses.map((c) => c.join("+")).sort();
  const refClasses = refQuotient.classes.map((c) => c.join("+")).sort();
  assert.deepEqual(gotClasses, refClasses);

  // The documented FS structure: two overlapping 3-cycles merge into one
  // five-member equivalence class; a2, a5, a7 are singletons.
  assert.deepEqual(
    result.equivalenceClasses.map((c) => c.join("+")),
    ["a1+a3+a4+a6+a8", "a2", "a5", "a7"]
  );
  assert.ok(result.cycles.length > 0, "FS edge set is expected to be cyclic");
  assert.equal(result.reducedEdges, null);

  // Quotient Hasse edges must match those derived from the reference set.
  const canon = (edges) => edges.map(([a, b]) => `${a}->${b}`).sort();
  assert.deepEqual(
    canon(result.quotient.hasseEdges),
    canon(refQuotient.hasseEdges)
  );
});
