import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	root: import.meta.dirname,
	test: {
		name: "signals",
		environment: "node",
		pool: "forks",
		fileParallelism: false,
		maxWorkers: 1,
		include: ["benchmarks/signals/**/*.test.mjs"],
		globalSetup: [
			path.join(import.meta.dirname, "benchmarks/signals/setup.mjs"),
		],
		testTimeout: 30_000,
		benchmark: {
			include: ["benchmarks/signals/**/*.bench.mjs"],
			includeSamples: true,
			outputJson: path.resolve(
				import.meta.dirname,
				"../../temp/signal-benchmark/vitest.json",
			),
		},
	},
});
