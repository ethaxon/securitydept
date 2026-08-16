import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, expect, inject, test } from "vitest";
import { createAdapter } from "./adapters.mjs";
import { cases, makeCase } from "./cases.mjs";

const modules = inject("signalModules");
const output = inject("signalOutput");
const names = ["baseline", "working", "alien", "polyfill", "preact"];
const results = [];
function worker(file, args) {
	return JSON.parse(
		execFileSync(
			process.execPath,
			["--expose-gc", path.join(import.meta.dirname, file), ...args],
			{ encoding: "utf8", timeout: 25_000 },
		),
	);
}
for (const name of names) {
	test(`${name}: workload correctness`, async () => {
		const adapter = await createAdapter(name, modules[name]);
		for (const scenario of cases.filter(
			(value) => !value.startsWith("memory-"),
		)) {
			const fixture = makeCase(adapter, scenario);
			if (!fixture) {
				continue;
			}
			try {
				for (let i = 1; i <= 3; i++) {
					await fixture.run(i);
				}
				fixture.check(3);
			} finally {
				fixture.stop?.();
			}
		}
	});
	for (const scenario of cases.filter((value) => value.startsWith("memory-"))) {
		test(`${name}: ${scenario}`, () => {
			const result = worker("memory-worker.mjs", [
				name,
				scenario,
				modules[name] ?? "",
			]);
			expect(result.samples).toHaveLength(3);
			for (const sample of result.samples) {
				expect(Number.isFinite(sample)).toBe(true);
			}
			results.push(result);
		});
	}
}
test("working: abandoned computeds are collectible after detachment", () => {
	const result = worker("gc-worker.mjs", ["working", modules.working]);
	expect(result.rounds).toHaveLength(4);
	for (const round of result.rounds) {
		expect(round.collected).toBeGreaterThanOrEqual(round.count * 0.99);
	}
	results.push(result);
});
afterAll(() => {
	writeFileSync(
		path.join(output, "diagnostics.json"),
		`${JSON.stringify({ node: process.version, results }, null, 2)}\n`,
	);
});
