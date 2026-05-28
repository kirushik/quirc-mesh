# Vendored quirc — provenance

This is the **fork base** for quirc-mesh, vendored read-only for reference. We
keep it so the algorithm work in `../../docs/ALGORITHM.md` can cite exact code and
so the new dev session has the prior art locally (no network needed).

- **Upstream**: https://github.com/dlbeer/quirc
- **Commit**: `927d680904dc95fdff4cd9d022eb374b438ff8f2`
- **License**: ISC (see `LICENSE`) — vendoring & forking permitted; preserve the notice.
- **Vendored**: 2026-05-28
- **Size**: 3,008 LOC total across `lib/` (identify.c 1153, decode.c 948, version_db.c 421, quirc.h 178, quirc.c 165, quirc_internal.h 143).

## sha256 of vendored files

```
d4468c55ecd0d2f905a6813513708005e6d609ef0a3d32a17673313c7552a7c1  lib/decode.c
ae858d86adcb12db80ad01f6d941cc2247fb5970abf0754f24dca027ede2ba99  lib/identify.c
0294b6c56f8c021b256c4c153d70483368164c6cf0cce643e1b6be03ed3585c0  lib/quirc.c
6764aa2f245085080e1e5cefd9dcd59b9727718a0d4606956e0502a57f5dff30  lib/version_db.c
49660ea710add2d6f304a1323f53190f5a2bf34db4dd160d633db0c3f22bfba5  lib/quirc.h
e383ed1a0ca70c07b0530d76bfeb6bd5525efda182589f48c978921a9e54676b  lib/quirc_internal.h
a70ef3ea032998eead2e2c7573a170a809eae08e3ca134611f707eda5932c8a9  LICENSE
```

Verify: `sha256sum lib/*.c lib/*.h LICENSE`.

## What to read (and where the problem is)

- **`lib/identify.c`** — detection. The single-homography limitation lives here:
  - `setup_qr_perspective()` (~line 850): one transform from 3 finders + 1 alignment pt.
  - `read_cell()` (~line 690): samples every module through that one transform.
  - `find_alignment_pattern()` (~line 578): finds only one alignment pattern.
  - `QUIRC_MAX_ALIGNMENT = 7` in `quirc_internal.h`; alignment coords used only for fitness scoring.
- **`lib/decode.c`** — format decode, demask, Reed–Solomon, segment decode. Reuse as-is.
- **`lib/version_db.c`** — per-version alignment-pattern coordinates + EC block tables. Port verbatim to `version_db.js`.

The fork's job: generalize alignment-pattern location to the full mesh and sample
the grid piecewise. See `../../docs/ALGORITHM.md`.
