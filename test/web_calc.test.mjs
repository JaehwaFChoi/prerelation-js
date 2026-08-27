/**
 * test/web_calc.test.mjs — the calculator layer.
 *
 * Three things are checked here, none of which touch the engine:
 *
 * 1. `web/calc_core.js` — CSV parsing, listwise deletion, the anchored
 *    [0, 1] range gate, the design floor on permutation replicates, the
 *    shape of the worker request, and CSV export.
 * 2. `web/prerelation.browser.js` — that the committed bundle is exactly
 *    what `tools/build_web_lib.mjs` produces from the current `src/`
 *    (freshness), and that it computes what the modules compute
 *    (parity: identical doubles, not merely close).
 * 3. The pure part of the worker protocol: a request built by calc_core
 *    drives the bundle's `scan` and comes back with one record per
 *    ordered pair and monotone progress.
 *
 * The golden vectors of the engine are tested elsewhere; nothing in this
 * file may be used to justify a change to `src/`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { prereqIndex, direction, scan, sfc32 } from "../src/index.mjs";
import { buildBundleSource } from "../tools/build_web_lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/**
 * Load a web/ file the way a browser does — as a classic script that
 * publishes onto the global object — and return the global name it
 * defines. The page's scripts are not ES modules (the page must open
 * from the file system), so this is the faithful loader, not a
 * workaround. It runs in this realm rather than a fresh context so that
 * arrays and objects coming out of the bundle can be compared directly
 * against the ones the modules produce; a separate realm would make
 * every deep comparison fail on prototype identity alone.
 */
function loadClassic(relPath, globalName) {
  const src = readFileSync(join(root, relPath), "utf8");
  vm.runInThisContext(src, { filename: relPath });
  const value = globalThis[globalName];
  assert.ok(value, `${relPath} did not define ${globalName}`);
  return value;
}

const CALC = loadClassic("web/calc_core.js", "PRERELATION_CALC");

function loadBundle() {
  return loadClassic("web/prerelation.browser.js", "PRERELATION");
}

function sample(n, seed, kind) {
  const next = sfc32(seed);
  const u = () => next() / 4294967296;
  const x = [];
  const y = [];
  for (let i = 0; i < n; i++) {
    const xi = u();
    const w = u();
    x.push(xi);
    y.push(kind === "product" ? xi * w : w);
  }
  return { x, y };
}

/* ------------------------------------------------------------ parsing */

test("parseTable reads a header, sniffs the delimiter and keeps every row", () => {
  const text = "skillA,skillB\n0.5,0.25\n0.9,0.81\n0.2,0.02\n";
  const parsed = CALC.parseTable(text);
  assert.equal(parsed.delimiter, ",");
  assert.equal(parsed.hadHeader, true);
  assert.deepEqual(parsed.names, ["skillA", "skillB"]);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[1], ["0.9", "0.81"]);
});

test("parseTable synthesizes names when the first row is numeric", () => {
  const parsed = CALC.parseTable("0.5,0.25\n0.9,0.81\n");
  assert.equal(parsed.hadHeader, false);
  assert.deepEqual(parsed.names, ["C1", "C2"]);
  assert.equal(parsed.rows.length, 2);
});

test("parseTable handles semicolons, tabs, quotes and CRLF", () => {
  const semi = CALC.parseTable('"a";"b"\r\n0.5;0.25\r\n');
  assert.equal(semi.delimiter, ";");
  assert.deepEqual(semi.names, ["a", "b"]);
  assert.deepEqual(semi.rows, [["0.5", "0.25"]]);

  const tabbed = CALC.parseTable("a\tb\n0.5\t0.25\n");
  assert.equal(tabbed.delimiter, "\t");
  assert.deepEqual(tabbed.names, ["a", "b"]);
});

test("parseTable rejects empty input and ragged rows", () => {
  assert.throws(() => CALC.parseTable("   \n\n"), /empty/);
  assert.throws(() => CALC.parseTable("a,b\n0.1,0.2\n0.3\n"), /expected 2/);
  assert.throws(() => CALC.parseTable("a,b\n"), /no data rows/);
});

test("listwiseSelect drops rows with any missing value in the selected columns", () => {
  const parsed = CALC.parseTable(
    ["a,b,c", "0.1,0.2,0.3", "0.4,NA,0.6", "0.7,0.8,", "0.2,0.3,0.4"].join("\n")
  );
  // Selecting a and b: only the NA row is incomplete.
  const ab = CALC.listwiseSelect(parsed.rows, [0, 1]);
  assert.equal(ab.kept, 3);
  assert.equal(ab.dropped, 1);
  assert.deepEqual(ab.data[0], [0.1, 0.2]);
  // Selecting a and c: only the empty-cell row is incomplete.
  const ac = CALC.listwiseSelect(parsed.rows, [0, 2]);
  assert.equal(ac.kept, 3);
  assert.equal(ac.dropped, 1);
  // Selecting all three: both incomplete rows go.
  const abc = CALC.listwiseSelect(parsed.rows, [0, 1, 2]);
  assert.equal(abc.kept, 2);
  assert.equal(abc.dropped, 2);
});

test("listwiseSelect needs at least two columns", () => {
  assert.throws(() => CALC.listwiseSelect([["0.1"]], [0]), /at least two/);
});

/* --------------------------------------------------------- range gate */

test("rangeGate accepts anchored data and reports the first violations", () => {
  assert.equal(CALC.rangeGate([[0, 1], [0.5, 0.5]]).ok, true);

  const bad = CALC.rangeGate([[0.2, 0.4], [1.4, 0.5], [0.3, -0.1]]);
  assert.equal(bad.ok, false);
  assert.equal(bad.violations.length, 2);
  assert.deepEqual(bad.violations[0], { row: 2, col: 0, value: 1.4 });
  assert.deepEqual(bad.violations[1], { row: 3, col: 1, value: -0.1 });
});

test("rangeGate rejects values on an unanchored scale rather than rescaling", () => {
  // A 0-100 percentage scale: every cell is a violation, and nothing in
  // calc_core offers a rescaling path.
  const pct = [[55, 30], [90, 81], [20, 2]];
  assert.equal(CALC.rangeGate(pct).ok, false);
  assert.equal(
    Object.keys(CALC).some((k) => /rescale|normali[sz]e|minmax/i.test(k)),
    false
  );
});

test("rangeGate stops early once the report limit is exceeded", () => {
  const many = Array.from({ length: 50 }, () => [2, 2]);
  const res = CALC.rangeGate(many, 3);
  assert.equal(res.ok, false);
  assert.equal(res.truncated, true);
  assert.equal(res.violations.length, 3);
});

/* ----------------------------------------------------------- M floor */

test("mFloor is ceil(K / alpha - 1) and matches the documented cases", () => {
  assert.equal(CALC.mFloor(2), 39); // K = 2  -> 2/0.05 - 1
  assert.equal(CALC.mFloor(3), 119); // K = 6  -> ECPE
  assert.equal(CALC.mFloor(8), 1119); // K = 56 -> fraction subtraction
  assert.equal(CALC.mFloor(4, 0.01), 1199);
});

test("the default replicate count always satisfies the floor", () => {
  for (let m = 2; m <= 12; m++) {
    assert.ok(CALC.defaultNPerm(m) >= CALC.mFloor(m));
  }
});

test("makeScanRequest enforces the floor, the shape and the seed", () => {
  const data = [[0.4, 0.2], [0.8, 0.5], [0.3, 0.1]];
  const ok = CALC.makeScanRequest(data, ["a", "b"], 39, 7);
  assert.equal(ok.cmd, "scan");
  assert.equal(ok.nPerm, 39);
  assert.equal(ok.seed, 7);
  assert.equal(ok.alpha, CALC.ALPHA);

  assert.throws(() => CALC.makeScanRequest(data, ["a", "b"], 38, 7), /design floor 39/);
  assert.throws(() => CALC.makeScanRequest(data, ["a"], 39, 7), /one entry per/);
  assert.throws(() => CALC.makeScanRequest(data, ["a", "b"], 39, 1.5), /seed/);
  assert.throws(() => CALC.makeScanRequest([], ["a", "b"], 39, 7), /no data rows/);
  assert.throws(
    () => CALC.makeScanRequest([[0.1, 0.2], [0.3]], ["a", "b"], 39, 7),
    /same number of columns/
  );
});

/* ---------------------------------------------------------- CSV export */

test("buildResultsCsv writes a header plus one row per record, Delta included", () => {
  const records = [
    {
      source: "a",
      target: "b",
      pi: 0.5,
      pi_reverse: 0.1,
      delta: 0.4,
      A1: 0.8,
      A2: 0.625,
      q: 0.7,
      ell: 0.9,
      p_value: 0.005,
      p_adj: 0.01,
      edge: true,
      n: 100,
      n_perm: 199,
    },
  ];
  const csv = CALC.buildResultsCsv(records);
  const lines = csv.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("delta"));
  assert.ok(lines[0].includes("A1"));
  assert.equal(lines[1], "a,b,0.5,0.1,0.4,0.8,0.625,0.7,0.9,0.005,0.01,true,100,199");
});

test("buildResultsCsv quotes separators inside names", () => {
  const csv = CALC.buildResultsCsv([{ source: 'skill, "one"', target: "b" }]);
  assert.ok(csv.split("\n")[1].startsWith('"skill, ""one""",b'));
});

/* ----------------------------------------------- bundle: freshness */

test("the committed browser bundle is exactly what the builder produces", () => {
  const committed = readFileSync(join(root, "web", "prerelation.browser.js"), "utf8");
  assert.equal(
    committed,
    buildBundleSource(),
    "web/prerelation.browser.js is stale — run `npm run build:web`"
  );
});

test("the bundle exposes the same public surface as the package entry point", () => {
  const bundle = loadBundle();
  const expected = [
    "DELTA",
    "TOP_Q",
    "MIN_INTERIOR",
    "DENSE_MAX_N",
    "prereqIndex",
    "direction",
    "permPvalue",
    "scan",
    "bhFdr",
    "findCycles",
    "transitiveReduction",
    "condense",
    "sfc32",
    "permutationStream",
  ];
  assert.deepEqual(Object.keys(bundle).sort(), expected.slice().sort());
  assert.equal(bundle.DELTA, 0.05);
  assert.equal(bundle.TOP_Q, 0.8);
});

/* -------------------------------------------------- bundle: parity */

test("bundle and modules agree bit for bit on the closed-form components", () => {
  const bundle = loadBundle();
  for (const kind of ["product", "independent"]) {
    for (const n of [80, 400]) {
      const { x, y } = sample(n, 4242 + n, kind);
      const a = prereqIndex(x, y);
      const b = bundle.prereqIndex(x, y);
      for (const key of ["PI", "A1", "A2", "q", "ell"]) {
        assert.equal(b[key], a[key], `${kind} n=${n} ${key}`);
      }
      const da = direction(x, y);
      const db = bundle.direction(x, y);
      assert.equal(db.delta, da.delta);
      assert.equal(db.forward, da.forward);
      assert.equal(db.reverse, da.reverse);
    }
  }
});

test("bundle and modules agree exactly on a seeded scan, p-values included", () => {
  const bundle = loadBundle();
  const next = sfc32(99);
  const u = () => next() / 4294967296;
  const theta = [];
  for (let i = 0; i < 120; i++) {
    const a = u();
    const b = a * u();
    theta.push([a, b, u()]);
  }
  const opts = { names: ["a", "b", "c"], nPerm: 119, seed: 20260827, alpha: 0.05 };
  const fromModule = scan(theta, opts);
  const fromBundle = bundle.scan(theta, opts);

  assert.equal(fromBundle.records.length, fromModule.records.length);
  fromModule.records.forEach((rec, i) => {
    const other = fromBundle.records[i];
    for (const key of ["source", "target", "pi", "pi_reverse", "delta", "A1", "A2", "q", "ell", "p_value", "p_adj", "edge"]) {
      assert.equal(other[key], rec[key], `record ${i} ${key}`);
    }
  });
  assert.deepEqual(fromBundle.edges, fromModule.edges);
  assert.deepEqual(fromBundle.cycles, fromModule.cycles);
  assert.deepEqual(fromBundle.equivalenceClasses, fromModule.equivalenceClasses);
  assert.deepEqual(fromBundle.quotient.hasseEdges, fromModule.quotient.hasseEdges);
});

/* ------------------------------------------- worker protocol (pure part) */

test("a calc_core request drives the bundle scan and reports monotone progress", () => {
  const bundle = loadBundle();
  const next = sfc32(2026);
  const u = () => next() / 4294967296;
  const rows = [];
  for (let i = 0; i < 90; i++) {
    const a = u();
    const b = a * u();
    const c = b * u();
    rows.push([String(a), String(b), String(c)]);
  }
  const sel = CALC.listwiseSelect(rows, [0, 1, 2]);
  assert.equal(CALC.rangeGate(sel.data).ok, true);

  const req = CALC.makeScanRequest(sel.data, ["a", "b", "c"], 119, 20260827);
  const seen = [];
  const result = bundle.scan(req.theta, {
    names: req.names,
    nPerm: req.nPerm,
    seed: req.seed,
    alpha: req.alpha,
    onProgress: (done, total) => seen.push([done, total]),
  });

  const K = 3 * 2;
  assert.equal(result.records.length, K);
  assert.equal(seen.length, K);
  assert.deepEqual(seen[0], [1, K]);
  assert.deepEqual(seen[seen.length - 1], [K, K]);
  for (let i = 1; i < seen.length; i++) {
    assert.equal(seen[i][0], seen[i - 1][0] + 1);
  }
  // Every record carries what the results table and the CSV export need.
  for (const rec of result.records) {
    for (const key of ["source", "target", "pi", "pi_reverse", "delta", "A1", "A2", "q", "ell", "p_value", "p_adj", "edge", "n", "n_perm"]) {
      assert.ok(key in rec, `missing ${key}`);
    }
  }
  assert.ok(CALC.buildResultsCsv(result.records).split("\n").length >= K + 1);
});

test("the worker script asks for the bundle and answers the three message types", () => {
  const src = readFileSync(join(root, "web", "worker.js"), "utf8");
  assert.ok(src.includes('importScripts("prerelation.browser.js")'));
  assert.ok(src.includes("PRERELATION.scan"));
  for (const type of ["progress", "result", "error"]) {
    assert.ok(src.includes(`type: "${type}"`), `worker never posts ${type}`);
  }
  // The worker must not carry statistics of its own.
  assert.equal(/Math\.(pow|sqrt|abs)\s*\(/.test(src), false);
});
