# prerelation-js

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22133624.svg)](https://doi.org/10.5281/zenodo.22133624)

A JavaScript implementation of the **prerelation coefficient** — a
coefficient for prerequisite relations between traits reported on a common
anchored scale — held in parity with the Python reference implementation
[`prerelation`](https://github.com/JaehwaFChoi/prerelation).

```
Pi(X -> Y) = A1 * A2        in [0, 1]

A1   the corner {Y > X} is empty, relative to what independence would give
A2   below the ceiling Y varies as a free component should (q), and the
     censoring thins out at high x (ell)

Delta = Pi(X -> Y) - Pi(Y -> X)
```

The product structure is what lets a single number separate the four
extremes. Independence is annihilated by `A1` alone; exact equivalence is
annihilated by `A2` alone.

Anchored scales are an interpretability requirement, not a claim about the
measurement precision of any scoring model: the ratio `Y / X` and the
corner moment `(Y - X)_+` only carry the reading "how much of the ceiling
granted by X is used by Y" when both endpoints are substantive anchors. On
an unanchored scale Pi carries no prerequisite interpretation.

## Install

No runtime dependencies. Node 18 or newer.

```bash
git clone https://github.com/JaehwaFChoi/prerelation-js.git
cd prerelation-js
npm test
```

The package is not published to npm; add it as a git dependency or vendor
`src/` directly. (npm publication is possible future work; GitHub and
Zenodo carry the citable artifact.)

## Quick start

```js
import { prereqIndex, direction, permPvalue, scan } from "./src/index.mjs";

const x = [/* trait values in [0, 1] */];
const y = [/* same length, same scale */];

prereqIndex(x, y);          // { PI, A1, A2, q, ell }
direction(x, y);            // { delta, forward, reverse }
permPvalue(x, y, { nPerm: 999, seed: 20260827 });

const theta = [/* rows are persons, columns attributes */];
const result = scan(theta, { names: ["A", "B", "C"], nPerm: 199 });
result.edges;               // pairs surviving BH-FDR control
result.reducedEdges;        // transitive reduction, or null when cyclic
result.equivalenceClasses;  // mutually dominating attributes, condensed
result.quotient.hasseEdges; // the Hasse edge set of the quotient order
```

`prereqIndex` returns the same five keys as the Python reference
implementation (`PI`, `A1`, `A2`, `q`, `ell`), so results transfer between
the two without renaming.

### Design floor on permutation replicates

With `k` attributes there are `K = k (k - 1)` ordered pairs, and the
smallest attainable permutation p-value is `1 / (nPerm + 1)`. For any pair
to survive Benjamini-Hochberg control at level `alpha`, the replicate count
must satisfy

```
nPerm >= K / alpha - 1
```

(`K = 6`, `alpha = 0.05` needs `nPerm >= 119`; `K = 56` needs
`nPerm >= 1119`). Below the floor the scan cannot return any edge,
regardless of the data.

## What the scan recovers

The edge set — and its transitive reduction, and the Hasse diagram of the
quotient order — is a **dominance preorder** over the attributes: which
attributes act as ceilings on which others. It is not a direct-prerequisite
DAG. Indirect dominance produces edges of its own, and siblings under a
common ceiling can be linked to each other even though neither is a
prerequisite for the other. Directed cycles, and the merged nodes they
condense into, are expected behaviour of a pairwise index. A disagreement
between the recovered order and an expert-specified prerequisite graph is a
difference between two concepts, not by itself an error in either.

## Parity with the reference implementation

The Python package is the reference implementation, and its permanent
oracle fixes the definition. This package is pinned to the published
release **prerelation 0.2.0**
(concept DOI [10.5281/zenodo.22132819](https://doi.org/10.5281/zenodo.22132819)).

`test/golden.test.mjs` replays the committed golden vectors from that
release:

| layer | fixtures | criterion |
|---|---|---|
| closed-form components (`v`, `v0`, `A1`, band masses, `q`, `ell`, `A2`, `PI`, `PI_reverse`, `Delta`) | `product`, `min`, `independent`, `equivalence`, `partial_equivalence`, `ecpe_slice` | agreement within `1e-12` absolute |
| permutation p-value, using the committed index matrices | all six | exact equality (the statistic is count-based) |

`test/fs_scan.test.mjs` adds a real-data scan check on the fraction
subtraction attribute set (8 attributes, n = 536, 56 ordered pairs): every
closed-form component agrees within `1e-12`, and a full scan reproduces the
reference edge set, cycle set and equivalence classes.

`tools/parity_fs/` records a stronger check that is not part of CI because
it needs Python and NumPy: with the reference run's own permutation-index
matrices injected pair by pair, all 56 p-values and adjusted p-values match
bit for bit.

```bash
python3 tools/parity_fs/gen_indices.py /tmp/fs_indices
node tools/parity_fs/run_injected.mjs /tmp/fs_indices
```

Note on random numbers: the built-in generator (`src/prng.mjs`, sfc32 seeded
through splitmix32) is deterministic and reproducible from a seed, but it is
not NumPy's stream. Cross-implementation p-value equality is defined only
through injected index matrices; a seeded run in one language will not
reproduce the seeded run of the other.

## Demo

`web/index.html` is a static page with no build step, no server and no
network access — open it directly in a browser. It shows, for two real
attribute sets:

- the directional Pi matrix;
- the Hasse diagram of the quotient order after equivalence-class
  condensation, with mutually dominating attributes drawn as one merged
  node;
- a pair inspector: the (theta_x, theta_y) scatter with the corner region
  and the ceiling band drawn on it, next to the component decomposition
  `A1 * (q * ell)`.

The two datasets are ECPE (3 skills, n = 2,922; the retained edges form a
chain) and fraction subtraction (8 attributes, n = 536; cycles condense
into one merged class).

Everything the page displays is precomputed by this package's own library,
not imported from another implementation:

```bash
node tools/precompute_demo.mjs     # rewrites web/demo_data.js
```

## Repository layout

```
src/          core.mjs, scan.mjs, prng.mjs, index.mjs
test/         golden.test.mjs, fs_scan.test.mjs, scan_unit.test.mjs, data/
tools/        precompute_demo.mjs, parity_fs/
web/          index.html, app.js, demo_data.js
```

`test/data/` holds the golden vectors copied from the reference release,
the trait tables for the two demo datasets, and the reference scan records
used by the fraction subtraction parity test.

## Citation

Cite the reference implementation for the method and this package for the
JavaScript port.

| | concept DOI (latest version) | this version |
|---|---|---|
| `prerelation` (Python, reference) | [10.5281/zenodo.22132819](https://doi.org/10.5281/zenodo.22132819) | 0.2.0: [10.5281/zenodo.22132820](https://doi.org/10.5281/zenodo.22132820) |
| `prerelation-js` (this package) | [10.5281/zenodo.22133624](https://doi.org/10.5281/zenodo.22133624) | 0.1.0: [10.5281/zenodo.22133625](https://doi.org/10.5281/zenodo.22133625) |

Machine-readable metadata is in `CITATION.cff`.

## License

MIT. See `LICENSE`.
