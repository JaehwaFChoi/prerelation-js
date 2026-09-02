/**
 * parity_core.mjs -- JavaScript side of the cross-language parity harness.
 *
 * Emits, for every committed golden fixture, the twenty quantities that
 * expected.json records (fifteen core, five reference-class) as full-
 * precision text (17 significant digits) in the CSV shape the Python driver
 * `prerelation-r/tools/parity/parity_driver.py` reads. The auxiliary
 * quantities v, v0 and p1_top are recomputed here from the definition
 * (dense double sum, diagonal included; type-7 quantile), because the
 * package does not export them.
 *
 * Usage: node tools/parity_core.mjs <golden_dir> <out_csv>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DELTA, TOP_Q, prereqIndex, direction, permPvalue, piEnvelope,
} from "../src/index.mjs";

const [golden, outCsv] = process.argv.slice(2);
const FIXTURES = ["product", "min", "independent", "equivalence", "partial_equivalence", "ecpe_slice"];

function readFixture(name) {
  const lines = readFileSync(join(golden, `fixture_${name}.csv`), "utf8").trim().split("\n");
  if (lines[0] !== "x,y") throw new Error(`${name}: expected header x,y`);
  const x = []; const y = [];
  for (let i = 1; i < lines.length; i++) {
    const [a, b] = lines[i].split(",");
    x.push(Number(a)); y.push(Number(b));
  }
  return { x, y };
}
function readPerm(n) {
  return readFileSync(join(golden, `perm_indices_n${n}.csv`), "utf8").trim().split("\n")
    .map((l) => Int32Array.from(l.split(","), Number));
}
function quantile7(sorted, p) {
  const n = sorted.length; const h = (n - 1) * p; const lo = Math.floor(h);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
function components(x, y, P) {
  const n = x.length;
  const res = prereqIndex(x, y); const rev = prereqIndex(y, x); const dl = direction(x, y);
  let v = 0; for (let i = 0; i < n; i++) v += Math.max(y[i] - x[i], 0); v /= n;
  let v0 = 0; for (let i = 0; i < n; i++) { let row = 0; for (let j = 0; j < n; j++) row += Math.max(y[j] - x[i], 0); v0 += row / n; } v0 /= n;
  const u = x.map((xi, i) => Math.min(1, Math.max(0, y[i] / Math.max(xi, 1e-9))));
  const ceil = u.map((w) => w >= 1 - DELTA);
  const thr = quantile7(Float64Array.from(x).sort(), TOP_Q);
  let nTop = 0, nTopCeil = 0;
  for (let i = 0; i < n; i++) if (x[i] >= thr) { nTop++; if (ceil[i]) nTopCeil++; }
  const p1Top = nTop > 0 ? nTopCeil / nTop : 1;
  const nCeil = ceil.filter(Boolean).length;
  const perm = permPvalue(x, y, { indices: P });
  const env = piEnvelope(x, y);
  return {
    n, v, v0, A1: res.A1, mass_ceiling_band: nCeil / n, mass_interior: (n - nCeil) / n,
    n_interior: n - nCeil, p1_top: p1Top, q: res.q, ell: res.ell, A2: res.A2, PI: res.PI,
    PI_reverse: rev.PI, Delta: dl.delta, perm_p: perm.pValue,
    n_tail_band: env.n_tail, D_star: env.D_star, sup_q: env.sup_q, inf_q: env.inf_q, PI_hi: env.PI_hi,
  };
}
const lines = ["fixture,quantity,value"];
for (const name of FIXTURES) {
  const { x, y } = readFixture(name);
  const comp = components(x, y, readPerm(x.length));
  for (const [k, val] of Object.entries(comp)) lines.push(`${name},${k},${Number(val).toPrecision(17)}`);
  console.log(`computed ${name.padEnd(20)} n=${x.length} PI=${comp.PI.toPrecision(17)}`);
}
writeFileSync(outCsv, lines.join("\n") + "\n");
console.log(`wrote ${outCsv} (${lines.length - 1} rows)`);
