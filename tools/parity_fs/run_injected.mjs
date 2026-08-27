/**
 * Cross-implementation p-value parity on the fraction subtraction scan:
 * run the JavaScript scan with the numpy-stream permutation-index
 * matrices produced by gen_indices.py injected per pair, and compare
 * every p-value (and the derived edge decisions) bit-for-bit against the
 * Python reference records.
 *
 * Usage: node tools/parity_fs/run_injected.mjs <indices_dir>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scan } from "../../src/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "..", "test", "data");
const idxDir = process.argv[2] ?? "/tmp/fs_indices";

const lines = readFileSync(join(dataDir, "d2_fs_theta.csv"), "utf8")
  .trim()
  .split("\n");
const names = lines[0].split(",");
const rows = lines.slice(1).map((l) => l.split(",").map(Number));

const refLines = readFileSync(join(dataDir, "d2_fs_scan_records_v1.csv"), "utf8")
  .trim()
  .split("\n");
const header = refLines[0].split(",");
const reference = refLines.slice(1).map((line) => {
  const parts = line.split(",");
  const rec = {};
  header.forEach((h, i) => {
    rec[h] =
      h === "source" || h === "target" || h === "edge" ? parts[i] : Number(parts[i]);
  });
  rec.edge = rec.edge === "True";
  return rec;
});

const N = 536;
const N_PERM = 1999;
const cache = new Map();
function indicesProvider(pos, n) {
  if (n !== N) throw new Error("unexpected n");
  if (!cache.has(pos)) {
    const buf = readFileSync(join(idxDir, `pair_${String(pos).padStart(2, "0")}.u16`));
    const flat = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2);
    const mat = [];
    for (let r = 0; r < N_PERM; r++) mat.push(flat.subarray(r * N, (r + 1) * N));
    cache.set(pos, mat);
  }
  const mat = cache.get(pos);
  cache.delete(pos); // each pair is used once; free memory
  return mat;
}

const t0 = Date.now();
const result = scan(rows, {
  names,
  alpha: 0.05,
  indicesProvider,
  onProgress: (d, t) => {
    if (d % 8 === 0) process.stderr.write(`pair ${d}/${t}\n`);
  },
});

let pExact = 0;
let pAdjExact = 0;
let edgeExact = 0;
const mism = [];
result.records.forEach((rec, i) => {
  const ref = reference[i];
  if (rec.source !== ref.source || rec.target !== ref.target) {
    throw new Error(`pair order mismatch at row ${i}`);
  }
  if (rec.p_value === ref.p_value) pExact += 1;
  else mism.push(`${rec.source}->${rec.target} p ${rec.p_value} vs ${ref.p_value}`);
  if (rec.p_adj === ref.p_adj) pAdjExact += 1;
  else mism.push(`${rec.source}->${rec.target} p_adj ${rec.p_adj} vs ${ref.p_adj}`);
  if (rec.edge === ref.edge) edgeExact += 1;
});

console.log(`p_value exact: ${pExact}/56`);
console.log(`p_adj exact:   ${pAdjExact}/56`);
console.log(`edge exact:    ${edgeExact}/56`);
console.log(`classes: ${result.equivalenceClasses.map((c) => c.join("+")).join(" | ")}`);
console.log(`elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (mism.length > 0) {
  console.log("MISMATCHES:");
  for (const m of mism) console.log("  " + m);
  process.exit(1);
}
console.log("PARITY: all 56 pairs bit-exact");
