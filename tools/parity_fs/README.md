# Cross-implementation p-value parity (fraction subtraction)

The JavaScript generator is not NumPy's stream, so a seeded run in one
language does not reproduce the seeded run of the other. Bit-exact
p-value parity is therefore checked by injecting the reference run's own
permutation indices into the JavaScript scan.

`gen_indices.py` regenerates, for each of the 56 ordered pairs, the 1999
permutations that `numpy.random.default_rng(20260827 + pairPosition)`
produced for the reference run, and writes them as `uint16` matrices.
`run_injected.mjs` feeds them to `scan` through its `indicesProvider` hook
and compares every `p_value`, `p_adj` and edge decision against
`test/data/d2_fs_scan_records_v1.csv`.

```bash
python3 tools/parity_fs/gen_indices.py /tmp/fs_indices   # needs NumPy
node tools/parity_fs/run_injected.mjs /tmp/fs_indices
```

Recorded result (2026-08-27): `p_value 56/56`, `p_adj 56/56`,
`edge 56/56` exact.

This check is kept out of CI because it requires Python and NumPy and
about 2 GB of intermediate index files; `test/fs_scan.test.mjs` covers the
same scan in CI at the level of the components and the decision structure.
