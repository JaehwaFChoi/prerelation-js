/**
 * Precompute the demo payload for `web/`.
 *
 * Everything the demo displays is produced here by the shipped library —
 * the demo exercises this package's own code, not results imported from
 * another implementation. Run from the repository root:
 *
 *     node tools/precompute_demo.mjs
 *
 * Inputs (shipped, they are also the parity fixtures):
 *   test/data/d1_ecpe_theta.csv   3 attributes, n = 2922
 *   test/data/d2_fs_theta.csv     8 attributes, n = 536
 *
 * Output: web/demo_data.js (a plain assignment to
 * `window.PRERELATION_DEMO`, so the demo page opens straight from the file
 * system with no server and no module loader).
 *
 * Trait values are written rounded to six decimals for display only; every
 * statistic in the payload was computed from the full-precision inputs.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { scan } from "../src/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function readTheta(path) {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const names = lines[0].split(",");
  const rows = lines.slice(1).map((l) => l.split(",").map(Number));
  return { names, rows };
}

const datasets = [
  {
    key: "ecpe",
    label: "ECPE",
    blurb: "Examination for the Certificate of Proficiency in English, three skills.",
    file: join(root, "test", "data", "d1_ecpe_theta.csv"),
    nPerm: 199,
    seed: 20260827,
  },
  {
    key: "fs",
    label: "Fraction subtraction",
    blurb: "Fraction subtraction attribute set, eight attributes.",
    file: join(root, "test", "data", "d2_fs_theta.csv"),
    nPerm: 1999,
    seed: 20260827,
  },
];

const payload = { generator: "tools/precompute_demo.mjs", datasets: {} };

for (const ds of datasets) {
  if (!existsSync(ds.file)) {
    console.error(`missing input: ${ds.file}`);
    process.exit(1);
  }
  const { names, rows } = readTheta(ds.file);
  const k = names.length;
  const K = k * (k - 1);
  const floor = Math.ceil(K / 0.05 - 1);
  if (ds.nPerm < floor) {
    console.error(
      `nPerm ${ds.nPerm} is below the design floor ${floor} for K = ${K}`
    );
    process.exit(1);
  }
  const t0 = Date.now();
  const result = scan(rows, {
    names,
    alpha: 0.05,
    nPerm: ds.nPerm,
    seed: ds.seed,
    onProgress: (d, t) => {
      if (d % 8 === 0 || d === t) process.stderr.write(`${ds.key} ${d}/${t}\r`);
    },
  });
  process.stderr.write("\n");

  payload.datasets[ds.key] = {
    label: ds.label,
    blurb: ds.blurb,
    names: result.names,
    n: rows.length,
    alpha: result.alpha,
    nPerm: ds.nPerm,
    seed: ds.seed,
    permFloor: floor,
    records: result.records.map((r) => ({
      source: r.source,
      target: r.target,
      pi: r.pi,
      pi_reverse: r.pi_reverse,
      delta: r.delta,
      A1: r.A1,
      A2: r.A2,
      q: r.q,
      ell: r.ell,
      p_value: r.p_value,
      p_adj: r.p_adj,
      edge: r.edge,
    })),
    edges: result.edges,
    reducedEdges: result.reducedEdges,
    cycles: result.cycles,
    classes: result.quotient.classes,
    quotientEdges: result.quotient.quotientEdges,
    hasseEdges: result.quotient.hasseEdges,
    theta: rows.map((row) => row.map((v) => Number(v.toFixed(6)))),
  };
  console.error(
    `${ds.key}: ${result.edges.length} edges, ${result.cycles.length} cycles, ` +
      `${result.quotient.classes.length} classes, ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}

const out = join(root, "web", "demo_data.js");
writeFileSync(out, `window.PRERELATION_DEMO = ${JSON.stringify(payload)};\n`);
console.error(`wrote ${out}`);
