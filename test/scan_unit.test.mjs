/** Unit tests for the graph routines and API guards. */
import test from "node:test";
import assert from "node:assert/strict";

import {
  bhFdr,
  findCycles,
  transitiveReduction,
  condense,
  prereqIndex,
  permPvalue,
  permutationStream,
} from "../src/index.mjs";

test("bhFdr: step-up, monotonised, clipped", () => {
  const adj = bhFdr([0.01, 0.04, 0.03, 0.005]);
  // Sorted p: .005 .01 .03 .04 -> ranked .02 .02 .04 .04 (after cummin).
  assert.deepEqual(adj, [0.02, 0.04, 0.04, 0.02]);
  assert.deepEqual(bhFdr([]), []);
  assert.deepEqual(bhFdr([1.0]), [1.0]);
});

test("transitiveReduction removes implied edges, keeps chains", () => {
  const nodes = ["A", "B", "C"];
  const edges = [
    ["A", "B"],
    ["B", "C"],
    ["A", "C"],
  ];
  assert.deepEqual(transitiveReduction(nodes, edges), [
    ["A", "B"],
    ["B", "C"],
  ]);
  assert.throws(() =>
    transitiveReduction(nodes, [
      ["A", "B"],
      ["B", "A"],
    ])
  );
});

test("findCycles reports directed cycles", () => {
  const nodes = ["A", "B", "C"];
  assert.equal(findCycles(nodes, [["A", "B"], ["B", "C"]]).length, 0);
  const cycles = findCycles(nodes, [
    ["A", "B"],
    ["B", "C"],
    ["C", "A"],
  ]);
  assert.equal(cycles.length, 1);
});

test("condense: overlapping cycles merge, quotient is a Hasse-ready DAG", () => {
  const nodes = ["a", "b", "c", "d", "e", "f"];
  // Two 3-cycles sharing node c -> one 5-member class; f hangs below.
  const edges = [
    ["a", "b"],
    ["b", "c"],
    ["c", "a"],
    ["c", "d"],
    ["d", "e"],
    ["e", "c"],
    ["a", "f"],
    ["b", "f"],
  ];
  const { classes, quotientEdges, hasseEdges, classOf } = condense(nodes, edges);
  const labels = classes.map((c) => c.join("+"));
  assert.deepEqual(labels, ["a+b+c+d+e", "f"]);
  assert.deepEqual(quotientEdges, [[classOf.get("a"), classOf.get("f")]]);
  assert.deepEqual(hasseEdges, quotientEdges);
});

test("condense on an acyclic chain reduces to the Hasse chain", () => {
  const nodes = ["x", "y", "z"];
  const edges = [
    ["x", "y"],
    ["y", "z"],
    ["x", "z"],
  ];
  const { classes, hasseEdges } = condense(nodes, edges);
  assert.deepEqual(classes, [["x"], ["y"], ["z"]]);
  assert.deepEqual(hasseEdges, [
    [0, 1],
    [1, 2],
  ]);
});

test("permutationStream: deterministic, valid permutations", () => {
  const a = permutationStream(7, 20)();
  const b = permutationStream(7, 20)();
  assert.deepEqual(Array.from(a), Array.from(b));
  assert.deepEqual(
    Array.from(a).slice().sort((p, q) => p - q),
    Array.from({ length: 20 }, (_, i) => i)
  );
  const c = permutationStream(8, 20)();
  assert.notDeepEqual(Array.from(a), Array.from(c));
});

test("permPvalue: internal generator is reproducible; add-one rule holds", () => {
  const n = 60;
  const x = Array.from({ length: n }, (_, i) => (i + 0.5) / n);
  const y = x.map((v, i) => v * ((i * 37) % 97) / 97);
  const r1 = permPvalue(x, y, { nPerm: 99, seed: 5 });
  const r2 = permPvalue(x, y, { nPerm: 99, seed: 5 });
  assert.equal(r1.pValue, r2.pValue);
  assert.ok(r1.pValue >= 1 / 100 && r1.pValue <= 1.0);
});

test("prereqIndex input guards", () => {
  assert.throws(() => prereqIndex([], []));
  assert.throws(() => prereqIndex([0.1], [0.1, 0.2]));
});
