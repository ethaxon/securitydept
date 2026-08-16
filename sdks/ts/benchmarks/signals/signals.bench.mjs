import assert from "node:assert/strict";
import { bench, describe, inject } from "vitest";
import { createAdapter } from "./adapters.mjs";
import { cases, makeCase } from "./cases.mjs";

const modules = inject("signalModules");
const names = ["baseline", "working", "alien", "polyfill", "preact"];
const adapters = await Promise.all(
	names.map((name) => createAdapter(name, modules[name])),
);

for (const [index, scenario] of cases
	.filter((name) => !name.startsWith("memory-"))
	.entries()) {
	describe(scenario, () => {
		// Rotate adapter order to reduce fixed thermal/order bias.
		for (let offset = 0; offset < names.length; offset++) {
			const position = (index + offset) % names.length;
			const adapter = adapters[position];
			const probe = makeCase(adapter, scenario);
			if (!probe) {
				bench.skip(names[position], () => {});
				continue;
			}
			probe.stop?.();
			let fixture;
			let iteration;
			let checksum;
			const run = () => {
				for (let i = 0; i < 256; i++) {
					checksum += fixture.run(++iteration);
				}
			};
			const asyncRun = async () => {
				for (let i = 0; i < 256; i++) {
					checksum += await fixture.run(++iteration);
				}
			};
			bench(names[position], probe.async ? asyncRun : run, {
				time: 500,
				warmupTime: 150,
				iterations: 10,
				warmupIterations: 5,
				async setup() {
					fixture = makeCase(adapter, scenario);
					iteration = 0;
					checksum = 0;
					if (fixture.async) {
						await asyncRun();
					} else {
						run();
					}
					fixture.check(iteration);
				},
				teardown() {
					try {
						fixture.check(iteration);
						assert.ok(Number.isFinite(checksum));
					} finally {
						fixture.stop?.();
					}
				},
			});
		}
	});
}
