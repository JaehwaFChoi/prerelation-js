/**
 * Golden-vector parity against the Python reference implementation
 * (prerelation 0.2.0). The contract is stated in the Python repository's
 * `tests/golden/README.md`:
 *
 * - every closed-form component agrees within 1e-12 absolute;
 * - the permutation p-value, computed with the committed permutation-index
 *   matrices, equals the published expected value EXACTLY (count-based).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DELTA, TOP_Q, prereqIndex, direction, permPvalue } from "../src/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "data");

function readPairFixture(name) {
  const text = readFileSync(join(dataDir, `fixture_${name}.csv`), "utf8");
  const lines = text.trim().split("\n");
  const x = [];
  const y = [];
  for (let i = 1; i < lines.length; i++) {
    const [xs, ys] = lines[i].split(",");
    x.push(Number(xs));
    y.push(Number(ys));
  }
  return { x, y };
}

function readIndexMatrix(n) {
  const text = readFileSync(join(dataDir, `perm_indices_n${n}.csv`), "utf8");
  return text
    .trim()
    .split("\n")
    .map((line) => Int32Array.from(line.split(","), Number));
}

const expected = JSON.parse(
  readFileSync(join(dataDir, "expected.json"), "utf8")
);

const TOL = 1e-12;

test("contract constants match the frozen definition", () => {
  assert.equal(expected._contract.delta, DELTA);
  assert.equal(expected._contract.top_q, TOP_Q);
  assert.equal(expected._contract.n_perm, 199);
});

const fixtureNames = Object.keys(expected).filter((k) => k !== "_contract");
const indexMatrices = { 200: readIndexMatrix(200), 400: readIndexMatrix(400) };

for (const name of fixtureNames) {
  test(`golden parity: ${name}`, () => {
    const exp = expected[name];
    const { x, y } = readPairFixture(name);
    assert.equal(x.length, exp.n);

    const fwd = prereqIndex(x, y);
    const dir = direction(x, y);

    assert.ok(Math.abs(fwd.PI - Number(exp.PI)) <= TOL, `PI: ${fwd.PI}`);
    assert.ok(Math.abs(fwd.A1 - Number(exp.A1)) <= TOL, `A1: ${fwd.A1}`);
    assert.ok(Math.abs(fwd.A2 - Number(exp.A2)) <= TOL, `A2: ${fwd.A2}`);
    assert.ok(Math.abs(fwd.q - Number(exp.q)) <= TOL, `q: ${fwd.q}`);
    assert.ok(Math.abs(fwd.ell - Number(exp.ell)) <= TOL, `ell: ${fwd.ell}`);
    assert.ok(
      Math.abs(dir.reverse - Number(exp.PI_reverse)) <= TOL,
      `PI_reverse: ${dir.reverse}`
    );
    assert.ok(
      Math.abs(dir.delta - Number(exp.Delta)) <= TOL,
      `Delta: ${dir.delta}`
    );

    // Band decomposition components.
    const n = x.length;
    const ceilCut = 1.0 - DELTA;
    let nCeil = 0;
    for (let i = 0; i < n; i++) {
      const den = Math.max(x[i], 1e-9);
      const u = Math.min(1, Math.max(0, y[i] / den));
      if (u >= ceilCut) nCeil += 1;
    }
    const massCeil = nCeil / n;
    assert.ok(
      Math.abs(massCeil - Number(exp.mass_ceiling_band)) <= TOL,
      `mass_ceiling_band: ${massCeil}`
    );
    assert.ok(
      Math.abs(1 - massCeil - Number(exp.mass_interior)) <= TOL,
      `mass_interior: ${1 - massCeil}`
    );
    assert.equal(n - nCeil, exp.n_interior);

    // Permutation p-value with the committed index matrices: exact match.
    const perm = permPvalue(x, y, { indices: indexMatrices[exp.n] });
    assert.equal(perm.pValue, Number(exp.perm_p), `perm_p: ${perm.pValue}`);
  });
}
