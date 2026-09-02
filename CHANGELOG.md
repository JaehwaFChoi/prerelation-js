# Changelog

All notable changes to `prerelation-js`. Versions follow the releases
archived on Zenodo; the concept DOI
[10.5281/zenodo.22133624](https://doi.org/10.5281/zenodo.22133624)
always resolves to the latest.

## 0.3.0 — 2026-09-02

Ports the admissible reference class and the exact upper envelope from the
Python reference implementation. **The computation engine is unchanged**:
`src/core.mjs`, `src/scan.mjs` and `src/prng.mjs` are byte-identical to
0.2.0.

- New `src/reference.mjs`, still with zero runtime dependencies: exports
  `admissibility`, `interiorQ`, `prereqIndexFamily`, `piEnvelope` and the
  reference constructors `uniformReference`, `betaReference`,
  `pointMassReference` and `attainingReference`.
- The regularised incomplete beta that `betaReference` needs is implemented
  in file (Lanczos log-gamma with a Lentz continued fraction) and is
  deliberately not exported: it is a platform gap-filler that the Python and
  R implementations take from `scipy` and base R, and no golden quantity
  depends on it.
- Checked against the Python golden vectors at a tolerance of 1e-12 over the
  thirty new quantities: twenty-seven bit-identical, largest absolute
  difference 1.665e-16. Every non-identical quantity is `PI_hi` on exactly
  the fixtures where `A1` was already non-identical, so the residue is the
  existing accumulation-order difference propagating rather than a new one.
- `tools/parity_core.mjs` added for the cross-language comparison. It
  recomputes `v`, `v0` and `p1_top` from the definition because the package
  does not export them, so those rows measure the harness and not the
  library.
  
## 0.2.0 — 2026-08-27

The demo page becomes a practitioner-facing guide with a working
calculator. **The computation engine is unchanged**: `src/core.mjs`,
`src/scan.mjs` and `src/prng.mjs` are byte-identical to 0.1.0, and the
18 golden-vector and scan tests pass untouched.

### Added

- **Upload calculator** (`web/index.html`, `web/calc_core.js`,
  `web/worker.js`). CSV in, statistics out, entirely in the browser: the
  file is read with `FileReader` and never leaves the machine.
  - Header detection, delimiter sniffing, listwise deletion with the
    dropped-row count shown.
  - Anchored-scale gate: values outside `[0, 1]` are refused with
    guidance and **no automatic rescaling**, since a silent min-max
    rescaling would fabricate the anchors Pi depends on.
  - Two columns give a pair card (Delta, both directions of Pi with
    components, permutation p, annotated scatter); three or more give
    the full scan (Pi matrix, Hasse diagram of the quotient order, pair
    inspector).
  - Design floor `M >= K / alpha - 1` enforced and displayed; the frozen
    constants `TOP_Q`, `delta` and `MIN_INTERIOR` displayed, not editable.
  - Permutations in a Web Worker with a progress bar and cancel, with a
    main-thread fallback where workers are unavailable.
  - Results table and CSV export including Delta and the components.
- **Six-section landing page**: the practitioner's question; how to read
  Delta and Pi; a live four-panel comparison with Pearson r; the
  calculator with two downloadable sample datasets; the two real-data
  demonstrations with structural explainers; and the ceiling mechanism
  with the program's origin and the software citation table.
- `tools/build_web_lib.mjs` and `npm run build:web`, generating
  `web/prerelation.browser.js` — a classic-script bundle of `src/` so the
  page and its worker can run the library with no build system.
- `test/web_calc.test.mjs`: 20 tests over the calculator logic, the
  bundle's freshness against `src/`, bundle-versus-module parity on
  identical doubles, and the worker protocol.

### Changed

- `Delta` is now named the **prerelation direction coefficient** and
  presented as such, with its limitation stated alongside every
  appearance: `Delta = 0` alone does not distinguish no relation from
  equivalent skills, so it is read together with the Pi pair.
- README: live demo link, the dual-scale reading, an explicit section on
  what Pi answers that a correlation does not, and calculator usage with
  the privacy note.

### Unchanged

- The definition, its frozen constants, and the oracle parity criterion.
- Scan output remains a **dominance preorder** over the attributes, not a
  direct-prerequisite DAG; cycles and merged nodes are expected behaviour
  of a pairwise index and are displayed as-is.

## 0.1.0 — 2026-08-27

Initial release: the JavaScript port of `prerelation` 0.2.0, in parity
with the reference implementation through the committed golden vectors
(closed-form components within 1e-12, permutation p-values exactly), plus
a static demo page for the two real-data attribute sets.
