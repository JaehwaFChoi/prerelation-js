"""Generate the numpy permutation-index matrices consumed by the Python
reference scan of the fraction subtraction data, for injection into the
JavaScript scan (cross-implementation p-value parity).

The reference run (prerelation 0.2.0) used, for the ordered pair at
row-major position `pos` (diagonal skipped),

    rng = numpy.random.default_rng(20260827 + pos)
    ...  rng.permutation(y)  # 1999 replicates, in order

`rng.permutation(y)` applies the same swap sequence as
`rng.permutation(n)`, so the index matrix below reproduces the exact
reference stream. One binary uint16 little-endian file per pair,
1999 x 536 indices, row-major.

Requires numpy. This script documents provenance of the recorded parity
verification; it is not part of the JS test suite run by CI.
"""
import sys
import numpy as np

OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/fs_indices"
SEED = 20260827
N = 536
N_PERM = 1999
K = 8

import os
os.makedirs(OUT, exist_ok=True)
for pos in range(K * (K - 1)):
    rng = np.random.default_rng(SEED + pos)
    mat = np.empty((N_PERM, N), dtype=np.uint16)
    for r in range(N_PERM):
        mat[r] = rng.permutation(N).astype(np.uint16)
    mat.tofile(os.path.join(OUT, f"pair_{pos:02d}.u16"))
print("wrote", K * (K - 1), "matrices to", OUT)
