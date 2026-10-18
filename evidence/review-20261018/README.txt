Local evidence, 2026-10-18, by moonf. NOT remote CI, NOT registry, NOT a broker run.
Toolchain: moon 0.1.20260920 (914d7da), moonc v0.10.14+7d59c7ec9, Node v24.18.0, macOS arm64.
Start commit: e066ff1d6c56292df65196fbe3102ba6fc02bcd1 (review/moonbit-20261015-sync).
test-js.log: moon test --target js -j 1 -> 68/68.
test-wasm-gc.log: moon test --target wasm-gc --package sundaysebasidian-byte/moonstomp -j 1 -> 68/68
  (without --package the wasm-gc build includes the JS-only bridge and fails to compile).
example-versions-*.log: moon run examples/versions on js / wasm-gc / native; offline frames
  supplied by the example (not a broker).
Go<->Artemis<->MoonBit interop was NOT re-run; see docs/verified-multiversion-20261015.zh-CN.md.
