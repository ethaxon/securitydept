import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { createAdapter } from "./adapters.mjs";
import { makeCase } from "./cases.mjs";

const [name, scenario, module] = process.argv.slice(2);
const fixture = makeCase(await createAdapter(name, module), scenario);
assert.ok(globalThis.gc && fixture.allocate);
const count = 30000;
const samples = [];
for (let sample = 0; sample < 3; sample++) {
	await setImmediate();
	globalThis.gc();
	const before = process.memoryUsage().heapUsed;
	let retained = Array.from({ length: count }, (_, i) => fixture.allocate(i));
	await setImmediate();
	globalThis.gc();
	samples.push((process.memoryUsage().heapUsed - before) / count);
	assert.equal(retained.length, count);
	retained = undefined;
}
console.log(
	JSON.stringify({ name, scenario, unit: "bytes/retained-item", samples }),
);
