import assert from "node:assert/strict";

export const cases = [
	"state-read",
	"state-write",
	"state-equal-write",
	"cached-computed",
	"dirty-computed",
	"dynamic-dependencies",
	"deep-100",
	"wide-100",
	"diamond",
	"layered-10x10",
	"unrelated-write-wide-100",
	"unrelated-write-wide-1000",
	"unrelated-write-wide-10000",
	"create-state",
	"create-computed",
	"create-read-computed",
	"observe-state",
	"observe-diamond",
	"rx-state",
	"rx-diamond",
	"rx-equal-computed",
	"watch-coalesced-100",
	"watch-microtask-100",
	"rx-detached-state",
	"watch-detached-state",
	"memory-state",
	"memory-computed",
	"memory-read-computed",
	"memory-updated-computed",
];

export function graph(adapter, shape) {
	const source = adapter.state(0);
	let sink = source;
	let factor = 1;
	let offset = 0;
	if (shape === "dirty-computed") {
		sink = adapter.computed(() => source.get() + 1);
		offset = 1;
	} else if (shape === "deep-100") {
		for (let i = 0; i < 100; i++) {
			const previous = sink;
			sink = adapter.computed(() => previous.get() + 1);
		}
		offset = 100;
	} else if (
		shape === "wide-100" ||
		shape.startsWith("unrelated-write-wide-")
	) {
		const width = Number(shape.split("-").at(-1));
		const leaves = Array.from({ length: width }, (_, i) =>
			adapter.computed(() => source.get() + i),
		);
		sink = adapter.computed(() =>
			leaves.reduce((sum, leaf) => sum + leaf.get(), 0),
		);
		factor = width;
		offset = (width * (width - 1)) / 2;
	} else if (shape === "diamond") {
		const left = adapter.computed(() => source.get() + 1);
		const right = adapter.computed(() => source.get() + 2);
		sink = adapter.computed(() => left.get() + right.get());
		factor = 2;
		offset = 3;
	} else if (shape === "layered-10x10") {
		let layer = [source];
		for (let i = 0; i < 10; i++) {
			const previous = layer;
			layer = Array.from({ length: 10 }, () =>
				adapter.computed(() =>
					previous.reduce((sum, node) => sum + node.get(), 0),
				),
			);
		}
		const finalLayer = layer;
		sink = adapter.computed(() =>
			finalLayer.reduce((sum, node) => sum + node.get(), 0),
		);
		factor = 10 ** 10;
	}
	assert.equal(sink.get(), offset);
	source.set(1);
	assert.equal(sink.get(), factor + offset);
	source.set(0);
	assert.equal(sink.get(), offset);
	return { source, sink, expected: (value) => value * factor + offset };
}

export function makeCase(adapter, name) {
	if (name.startsWith("memory-")) {
		return {
			allocate(i) {
				const source = adapter.state(i);
				if (name === "memory-state") {
					return source;
				}
				const sink = adapter.computed(() => source.get() + 1);
				if (
					name === "memory-read-computed" ||
					name === "memory-updated-computed"
				) {
					sink.get();
				}
				if (name === "memory-updated-computed") {
					source.set(i + 1);
					sink.get();
				}
				return { source, sink };
			},
		};
	}
	if (name.startsWith("create-")) {
		const retained = new Array(1024);
		return {
			run(i) {
				const source = adapter.state(i);
				if (name === "create-state") {
					retained[i % 1024] = source;
					return i;
				}
				const sink = adapter.computed(() => source.get() + 1);
				retained[i % 1024] = { source, sink };
				return name === "create-read-computed" ? sink.get() : i;
			},
			check: () => assert.ok(retained.some(Boolean)),
		};
	}
	if (
		name.startsWith("rx-") ||
		name.startsWith("watch-") ||
		name.startsWith("observe-")
	) {
		if (!adapter.observe || (!adapter.rx && !name.startsWith("observe-"))) {
			return null;
		}
		if (name === "rx-detached-state" || name === "watch-detached-state") {
			const source = adapter.state(0);
			adapter.observe(
				source,
				() => {},
				name.startsWith("rx-") ? "rx" : "watch",
				(flush) => flush(),
			)();
			return {
				run(i) {
					source.set(i);
					return i;
				},
				check: (i) => assert.equal(source.get(), i),
			};
		}
		const equal = name === "rx-equal-computed";
		const { source, sink, expected } = equal
			? (() => {
					const source = adapter.state(1, { equals: () => false });
					return {
						source,
						sink: adapter.computed(() => source.get(), { equals: () => false }),
						expected: () => 1,
					};
				})()
			: graph(adapter, name.endsWith("diamond") ? "diamond" : "state");
		let latest = sink.get();
		let calls = 0;
		let pending;
		const coalesced = name === "watch-coalesced-100";
		const microtask = name === "watch-microtask-100";
		const stop = adapter.observe(
			sink,
			(value) => {
				latest = value;
				calls++;
			},
			name.startsWith("rx-") ? "rx" : "watch",
			microtask
				? queueMicrotask
				: coalesced
					? (flush) => {
							pending = flush;
						}
					: (flush) => flush(),
		);
		const initialCalls = calls;
		let runs = 0;
		let last = 0;
		function run(i) {
			runs++;
			if (coalesced || microtask) {
				for (let j = 0; j < 100; j++) {
					source.set(i * 100 + j);
				}
				last = i * 100 + 99;
				if (coalesced) {
					const flush = pending;
					pending = undefined;
					flush();
				}
			} else {
				last = equal ? 1 : i;
				source.set(last);
			}
			return latest;
		}
		return {
			run: microtask
				? async (i) => {
						run(i);
						await Promise.resolve();
						return latest;
					}
				: run,
			async: microtask,
			check() {
				assert.equal(latest, expected(last));
				assert.equal(calls - initialCalls, runs);
			},
			stop,
		};
	}
	if (name === "dynamic-dependencies") {
		const select = adapter.state(0);
		const a = adapter.state(10);
		const b = adapter.state(20);
		let computations = 0;
		const sink = adapter.computed(() => {
			computations++;
			return select.get() % 2 ? a.get() : b.get();
		});
		assert.equal(sink.get(), 20);
		a.set(11);
		assert.equal(sink.get(), 20);
		assert.equal(computations, 1);
		select.set(1);
		assert.equal(sink.get(), 11);
		b.set(21);
		assert.equal(sink.get(), 11);
		assert.equal(computations, 2);
		return {
			run(i) {
				select.set(i);
				return sink.get();
			},
			check(i) {
				assert.equal(sink.get(), i % 2 ? 11 : 21);
			},
		};
	}
	if (name.startsWith("state-")) {
		const source = adapter.state(1);
		return {
			run:
				name === "state-read"
					? () => source.get()
					: name === "state-equal-write"
						? () => {
								source.set(1);
								return 1;
							}
						: (i) => {
								source.set(i);
								return i;
							},
			check: (i) => assert.equal(source.get(), name === "state-write" ? i : 1),
		};
	}
	const { source, sink, expected } = graph(
		adapter,
		name === "cached-computed" ? "dirty-computed" : name,
	);
	const unrelated = name.startsWith("unrelated-") ? adapter.state(0) : null;
	return {
		run:
			name === "cached-computed"
				? () => sink.get()
				: (i) => {
						(unrelated ?? source).set(i);
						return sink.get();
					},
		check: (i) =>
			assert.equal(
				sink.get(),
				expected(unrelated || name === "cached-computed" ? 0 : i),
			),
	};
}
