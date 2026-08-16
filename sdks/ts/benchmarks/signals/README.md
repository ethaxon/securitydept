# Signal benchmarks

Permanent benchmark source belongs in this directory and in Git. Generated results, bundles and profiles belong only in ignored `temp/signal-benchmark/`. Experimental kernels are not part of this suite.

Use the repository's `mise.toml` toolchain from the root:

```sh
mise exec -- pnpm bench:sdks
mise exec -- pnpm test:sdks
# Filter timing cases and compare with a previously saved Vitest result.
mise exec -- pnpm bench:sdks -t 'diamond|dynamic-dependencies'
mise exec -- pnpm bench:sdks --compare "$PWD/temp/signal-benchmark/previous.json"
# Select a historical Signal source baseline explicitly.
SIGNAL_BASELINE=<commit> mise exec -- pnpm bench:sdks
```

`sdks/ts/vitest.config.ts` includes the regular SDK and Signal projects. `vitest.bench.config.ts` uses the installed Vitest 4 API (`bench`, `benchmark.include`, `includeSamples`, `outputJson`). [Vitest benchmark configuration](https://vitest.dev/config/benchmark) is the reference; newer online documentation may describe APIs absent in this installed version. Timing benchmarks run serially; diagnostic tests are included in the normal SDK test command. Use `pnpm --filter @securitydept/ts-sdks exec vitest bench --config vitest.config.ts` for watch mode. Save `vitest.json` before another run when using `--compare`.

- `signals.bench.mjs`: 25 timing workloads covering state, cached/dirty computed, dynamic dependencies, deep/wide/diamond/layered graphs, creation, unrelated writes, synchronous watch, coalesced/microtask watch and lossless Rx interop. Each Tinybench invocation performs **256 operations** to amortize timer overhead; reported latency/throughput is per batch. Each task uses 150 ms warm-up and 500 ms measurement. Fixture assertions and teardown stay outside timing.
- `diagnostics.test.mjs`: workload correctness for five adapters, four retained-memory workloads per adapter, and production GC collection. Memory and GC use isolated Node processes with `--expose-gc`, not benchmark latency measurements. Memory retains 30,000 items per sample, three samples; GC drops 20,000 computeds per round, four rounds, half subscribed/unsubscribed first, and requires at least 99% collection plus live-value coherence.
- `setup.mjs`: reuses the existing tsdown toolchain to bundle Git baseline (default `HEAD`) and working Signal source with ES2022 targeting, recording commit/source/bundle/lock hashes and environment in `metadata.json`. Both share current support modules/dependencies; this is a single-module comparison. Keep an explicit baseline commit after committing changes.
- `adapters.mjs` / `cases.mjs`: shared fixtures using the framework-independent shape of [js-reactivity-benchmark](https://github.com/transitive-bullshit/js-reactivity-benchmark). Pinned Alien, signal-polyfill and Preact dependencies belong to the private `sdks/ts/benchmarks` workspace package. Unsupported notification contracts are skipped explicitly in timing and checked only where supported.

Outputs are `vitest.json`, `metadata.json`, and `diagnostics.json`. Retained memory includes wrappers/arrays, not native node sizes or allocation rates. GC boundaries cross event-loop turns for WeakRef liveness. Run without concurrent builds/tests; repeat independent runs for small differences. Vitest/Tinybench results use a different sampling method from the archived custom-runner results and are not directly interchangeable. Watch/effect and equal-write guarantees differ across adapters; these results do not establish authentication throughput, browser latency, universal rankings or full TC39 conformance.

## Implementation decision

Keep one RxSignal backend: raw state storage, lazy Rx value mirrors, native dirty callbacks, and the Map snapshot kernel. Preserve public API, existing lossless Rx semantics, synchronous depth-first ordering, and foreign/public dirty-observable protocols. Kernel migration must also preserve automatic collection; the rejected experiments and measured gains are summarized in the root changelog.

Append Vitest filters directly to `bench:sdks`; append `--` after `test:sdks` to forward filters through Turbo, for example `pnpm test:sdks -- -t 'memory-|collectible'`. To select only the benchmark diagnostic project without running other SDK packages, use `pnpm --filter @securitydept/ts-sdks test --project signals` (pnpm passes script flags directly).

[English](README.md) | [中文](README.zh.md)
