/**
 * The admissible reference class and the exact upper envelope: parity with
 * the Python reference implementation on the six golden fixtures (the five
 * new keys per fixture in expected.json, tolerance 1e-12), the bit-for-bit
 * identities the composition guarantees, and the class-vs-dominance
 * distinction.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  prereqIndex,
  admissibility,
  interiorQ,
  prereqIndexFamily,
  piEnvelope,
  uniformReference,
  betaReference,
  pointMassReference,
  attainingReference,
} from "../src/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "data");
const TOL = 1e-12;

function readPairFixture(name) {
  const lines = readFileSync(join(dataDir, `fixture_${name}.csv`), "utf8").trim().split("\n");
  const x = [];
  const y = [];
  for (let i = 1; i < lines.length; i++) {
    const [xs, ys] = lines[i].split(",");
    x.push(Number(xs));
    y.push(Number(ys));
  }
  return { x, y };
}

const expected = JSON.parse(readFileSync(join(dataDir, "expected.json"), "utf8"));
const fixtureNames = Object.keys(expected).filter((k) => k !== "_contract");
const NEW_KEYS = ["D_star", "sup_q", "inf_q", "PI_hi"];

for (const name of fixtureNames) {
  test(`envelope parity: ${name}`, () => {
    const exp = expected[name];
    const { x, y } = readPairFixture(name);
    const env = piEnvelope(x, y);
    assert.equal(env.n_tail, exp.n_tail_band);
    for (const key of NEW_KEYS) {
      assert.ok(Math.abs(env[key] - Number(exp[key])) <= TOL, `${key}: ${env[key]} vs ${exp[key]}`);
    }
    assert.ok(env.attained);
  });

  test(`interiorQ at Uniform equals core q bitwise: ${name}`, () => {
    const { x, y } = readPairFixture(name);
    assert.equal(interiorQ(x, y), prereqIndex(x, y).q);
    assert.equal(interiorQ(x, y, uniformReference()), prereqIndex(x, y).q);
  });

  test(`family member at Uniform equals PI bitwise: ${name}`, () => {
    const { x, y } = readPairFixture(name);
    assert.equal(prereqIndexFamily(x, y).PI, prereqIndex(x, y).PI);
  });
}

for (const name of fixtureNames.filter((n) => n !== "equivalence")) {
  test(`supremum attained by F0*, bounds admissible references: ${name}`, () => {
    const { x, y } = readPairFixture(name);
    const env = piEnvelope(x, y);
    const Fs = attainingReference(x, y);
    assert.ok(admissibility(Fs).admissible);
    assert.ok(Math.abs(interiorQ(x, y, Fs) - env.sup_q) <= TOL);
    for (const F of [uniformReference(), betaReference(2, 10), betaReference(1, 2), pointMassReference(0)]) {
      assert.ok(admissibility(F).admissible, F.referenceName);
      assert.ok(interiorQ(x, y, F) <= env.sup_q + TOL, F.referenceName);
      assert.ok(prereqIndexFamily(x, y, F).PI <= env.PI_hi + TOL, F.referenceName);
    }
    assert.ok(Math.abs(interiorQ(x, y, pointMassReference(0)) - env.inf_q) <= TOL);
    assert.ok(Math.abs(env.inf_q - 1 / env.m) <= TOL);
  });
}

test("Uniform is the boundary point of B", () => {
  const a = admissibility(uniformReference());
  assert.ok(a.admissible);
  assert.ok(Math.abs(a.tailMass - 0.05) <= 1e-12);
  assert.ok(Math.abs(a.worstSlack) <= 1e-12);
});

test("ceiling-loaded references are rejected: Beta(2,1) tail 0.0975, Beta(8,2) tail 0.0712", () => {
  const r21 = admissibility(betaReference(2, 1));
  assert.ok(!r21.admissible && Math.abs(r21.tailMass - 0.0975) < 5e-5);
  const r82 = admissibility(betaReference(8, 2));
  assert.ok(!r82.admissible && Math.abs(r82.tailMass - 0.0712) < 5e-5);
});

test("membership is weaker than dominance: Beta(2,10) fails dominance at the floor, belongs to B", () => {
  const F = betaReference(2, 10);
  assert.ok(F(0.01) < 0.01);
  assert.ok(Math.abs(F(0.01) - 0.00518) < 1e-5);
  const r = admissibility(F);
  assert.ok(r.admissible);
  assert.ok(r.tailMass < 1e-11);
});

test("positive part in D* matters (E-6a case 3c input)", () => {
  // t_(m) = 0.96 in the tail band but below its index m/m = 1: D* = 0, sup_q = 1
  const m = 100;
  const t = [];
  for (let i = 0; i < m - 1; i++) t.push(0.005 + (i * (0.9 - 0.005)) / (m - 2));
  t.push(0.96);
  const x = new Array(m).fill(0.5);
  const y = t.map((v) => 0.5 * v * (1.0 - 0.05));
  const env = piEnvelope(x, y);
  assert.equal(env.n_tail, 1);
  assert.equal(env.D_star, 0.0);
  assert.equal(env.sup_q, 1.0);
  assert.ok(env.attained);
});

test("guard case is all zero", () => {
  const { x, y } = readPairFixture("equivalence");
  const env = piEnvelope(x, y);
  assert.equal(env.m, 0);
  assert.equal(env.sup_q, 0);
  assert.equal(env.inf_q, 0);
  assert.equal(env.PI_hi, 0);
});
