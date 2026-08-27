# prerelation-js

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22133624.svg)](https://doi.org/10.5281/zenodo.22133624)

**Live demo and calculator:**
<https://jaehwafchoi.github.io/prerelation-js/web/>

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

## How to read the two scales

**Delta — the prerelation direction coefficient.**
`Delta = Pi(X -> Y) - Pi(Y -> X)` lies in `[-1, +1]` and is antisymmetric.
Its **sign is the direction** — positive means X is the prerequisite side —
and its **magnitude is the strength of the asymmetry**. It reads like a
signed coefficient, the natural counterpart to how practitioners read r.

*Read Delta together with the Pi pair:* `Delta = 0` by itself does not
distinguish "no relation" from "equivalent skills" — both put the two
directions on an equal footing.

**Pi — per-direction strength.** `Pi` lies in `[0, 1]`: **0 means no
prerequisite relation, 1 means a perfect prerequisite relation**. It is a
continuous quantity, read like a correlation magnitude; the package
defines no thresholds and no cutoffs.

**The reading ladder.** Permutation p (is there a relation at all) ->
Delta (which direction, how asymmetric) -> the Pi pair (per-direction
strength).

## Relation to the correlation coefficient

Pearson r answers a symmetric question: do X and Y move together?
Prerequisite-ness is asymmetric: does progress in Y require X first? A
high r cannot separate X -> Y from Y -> X, nor either from "both reflect
one shared ability", and two nearly identical skills correlate almost
perfectly while neither is a prerequisite for the other. Pi scores the
one-sided ceiling footprint instead, which is why the equivalence case
splits the two apart: r is close to 1 while `Delta = 0` and both `Pi = 0`.
That is a property of the definitions. The two coefficients answer
different questions; Pi complements r rather than replacing it.

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

`test/web_calc.test.mjs` covers the calculator layer that the demo page
adds on top of the library: CSV parsing and listwise deletion, the
anchored-range gate, the design floor, the worker request shape and the
CSV export, plus the freshness and parity of the generated browser
bundle. Nothing in that file may be used to justify a change to `src/`.

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

## Demo page and calculator

`web/index.html` is a static page with no build step, no server and no
network access. Open it locally, or use the published copy at
<https://jaehwafchoi.github.io/prerelation-js/web/>.

**The calculator.** Upload a CSV of scores on the anchored `[0, 1]` scale
— one column per skill, one row per person — and the page computes
everything in your browser. The file is read with `FileReader` and never
leaves the machine: there is no upload endpoint and the page makes no
network requests.

- Header detection and delimiter sniffing (comma, semicolon, tab);
  listwise deletion of rows with missing values, with the count shown.
- **Anchored-scale gate.** Values outside `[0, 1]` are a hard error with
  guidance, and the page does *not* rescale: a silent min-max rescaling
  would fabricate the anchors that give Pi its reading.
- Two selected columns give a pair card: Delta (labelled the prerelation
  direction coefficient), Pi in both directions with the components,
  the permutation p-value at a replicate count you set, and the scatter
  with the corner and ceiling overlays.
- Three or more columns give the full scan: Pi matrix, the Hasse diagram
  of the quotient order, and a pair inspector. The **design floor**
  `M >= K / alpha - 1` is enforced and displayed.
- Permutations run in a Web Worker with a progress bar and a cancel
  button, falling back to the main thread where workers are unavailable.
  The frozen constants (`TOP_Q`, `delta`, `MIN_INTERIOR`) are displayed
  and not editable.
- Results table plus CSV export, Delta and the components included.
  Bootstrap confidence intervals are out of scope for this version.

**Sample data.** Two small files to try it with:

| file | shape | what to expect |
|---|---|---|
| [`sample1_prereq_pair.csv`](https://drive.google.com/file/d/1B0JLxBuko6YOerR9qjAeELlurARBZvaH/view) | 500 x 2 (basic_arithmetic, algebra) | a strong one-directional result (arithmetic -> algebra), near-zero reverse; compare with the Pearson r shown |
| [`sample2_skill_chain.csv`](https://drive.google.com/file/d/1uY0L4ULmEzb6xjf8OqYr1-2OVWQPEjCF/view) | 600 x 5 (counting -> addition -> multiplication -> division, plus unrelated spelling) | the chain, with direct links strongest and indirect links weaker (the Hasse view prunes implied links); spelling connected to nothing |

**Real-data demonstrations.** The page also shows two recorded scans:
ECPE (3 attributes, n = 2,922; the retained edges form a chain) and
fraction subtraction (8 attributes, n = 536; cycles condense into one
merged node, shown as-is).

Everything the page displays is computed by this package's own library —
live in the browser for the four-panel comparison and the calculator, and
from the library's own recorded seeded runs for the two demonstrations:

```bash
node tools/precompute_demo.mjs     # rewrites web/demo_data.js
npm run build:web                  # rewrites web/prerelation.browser.js from src/
```

`web/prerelation.browser.js` is a generated classic-script bundle of
`src/` so that the page and its worker can run the library without a
build system. It is never edited by hand: `test/web_calc.test.mjs`
fails if the committed bundle is not what the builder produces from the
current `src/`, and separately checks that the bundle and the ES modules
return identical doubles.

## Repository layout

```
src/          core.mjs, scan.mjs, prng.mjs, index.mjs
test/         golden.test.mjs, fs_scan.test.mjs, scan_unit.test.mjs,
              web_calc.test.mjs, data/
tools/        precompute_demo.mjs, build_web_lib.mjs, parity_fs/
web/          index.html, app.js, calc_core.js, worker.js,
              prerelation.browser.js (generated), demo_data.js
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
