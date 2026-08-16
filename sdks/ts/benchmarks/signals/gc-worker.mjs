import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";

const [name, module] = process.argv.slice(2);
const { RxStateSignal, RxComputedSignal } = await import(module);
assert.ok(globalThis.gc, "Run with --expose-gc");
const source = RxStateSignal.fromInitialValue(0);
const live = RxComputedSignal.computed(() => source.get() + 1);
assert.equal(live.get(), 1);
const count = 20000;
function allocate() {
	return Array.from({ length: count }, (_, i) => {
		const padding = new Array(32).fill(i);
		const computed = RxComputedSignal.computed(() => source.get() + padding[0]);
		computed.get();
		if (i % 2 === 0) {
			computed
				.dirtyObservable()
				.subscribe(() => {})
				.unsubscribe();
		}
		return new WeakRef(computed);
	});
}
async function collect() {
	// Do not dereference probes inside this loop: that would extend target liveness.
	for (let i = 0; i < 12; i++) {
		await setImmediate();
		globalThis.gc();
	}
}
await collect();
const initialHeap = process.memoryUsage().heapUsed;
const rounds = [];
for (let round = 1; round <= 4; round++) {
	const probes = allocate();
	await collect();
	source.set(round);
	assert.equal(live.get(), round + 1);
	const collected = probes.filter((probe) => !probe.deref()).length;
	assert.ok(
		collected >= count * 0.99,
		`${name}: only ${collected}/${count} collected`,
	);
	rounds.push({
		round,
		collected,
		count,
		retainedHeapDelta: process.memoryUsage().heapUsed - initialHeap,
	});
}
console.log(JSON.stringify({ name, rounds }));
