Local evidence, 2026-10-18, by moonf. NOT remote CI, NOT registry, NOT a broker run.
Toolchain: moon 0.1.20260920 (914d7da), moonc v0.10.14+7d59c7ec9, Node v24.18.0, macOS arm64.
Start commit: e066ff1d6c56292df65196fbe3102ba6fc02bcd1 (review/moonbit-20261015-sync).
test-js.log: moon test --target js -j 1 -> 68/68.
test-wasm-gc.log: moon test --target wasm-gc --package sundaysebasidian-byte/moonstomp -j 1 -> 68/68
  (without --package the wasm-gc build includes the JS-only bridge and fails to compile).
example-versions-*.log: moon run examples/versions on js / wasm-gc / native; offline frames
  supplied by the example (not a broker).

UPDATE (integration round, same day): the statement above that interop was not re-run is superseded.
The integrated candidate (core from moonb fix/core-ci-20261018 605f6f6 + docs/examples) ran
scripts/verify.py with --transport and the real Artemis 2.57.0 + go-stomp c155a2d (Go 1.27.1, Java 17.0.20,
--broker-port 62613): 18/18 stages PASSED, overall PASSED_WITH_ARTEMIS_PROFILE_LIMITATION_AND_UNTESTED_REMOTE_CI.
Full logs are in the integration report directory (out/stomp-final), not copied here.
The 2026-10-15 Linux/Java21/Go1.26.8 record (docs/verified-multiversion-20261015.zh-CN.md) is a different environment.
