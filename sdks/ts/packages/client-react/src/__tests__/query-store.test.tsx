// @vitest-environment jsdom

import {
	ClientError,
	createSecuritydeptDestroyRef,
	createSignal,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
	SecuritydeptDestroyRef,
	SYMBOL_OBSERVABLE,
} from "@securitydept/client";
import { createTimeForTest } from "@securitydept/client/test";
import {
	act,
	Component,
	createElement,
	Fragment,
	type ReactElement,
	type ReactNode,
	StrictMode,
	Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEnvironmentForReact } from "../environment";
import { SecuritydeptProvider } from "../injection/index";
import { QueryStore } from "../query-store";
import { useSuspenseResourceValue } from "../suspense-resource";

function readQueryStoreQueries(this: QueryStore): readonly object[] {
	const queries = Reflect.get(this, "queries");
	if (!(queries instanceof Map)) {
		throw new TypeError("QueryStore queries are unavailable.");
	}
	return [...queries.values()];
}

function readQueryStoreQueryCount(store: QueryStore): number {
	return readQueryStoreQueries.bind(store)().length;
}

function readQueryStorePendingPromises(
	store: QueryStore,
): readonly Promise<unknown>[] {
	return readQueryStoreQueries
		.bind(store)()
		.map((query) => {
			const state = Reflect.get(query, "state")?.get();
			return state?.status === "pending" ? state.promise : undefined;
		})
		.filter(
			(promise): promise is Promise<unknown> => promise instanceof Promise,
		);
}

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return {
		container,
		rerender(nextElement: ReactElement) {
			act(() => root.render(nextElement));
		},
		unmount() {
			act(() => root.unmount());
			container.remove();
		},
	};
}

class TestErrorBoundary extends Component<
	{ readonly children?: ReactNode },
	{ readonly error: unknown | null }
> {
	override state = { error: null };

	static getDerivedStateFromError(error: unknown) {
		return { error };
	}

	override render() {
		return this.state.error === null
			? this.props.children
			: createElement(
					"div",
					{ "data-error": "true" },
					(this.state.error as Error).message,
				);
	}
}

function createHarness(options: { gcTimeMs?: number } = {}) {
	const time = createTimeForTest();
	const environment = createEnvironmentForReact({
		time,
		providers:
			options.gcTimeMs === undefined
				? []
				: [
						{
							provide: QueryStore,
							useValue: new QueryStore({
								time,
								gcTimeMs: options.gcTimeMs,
							}),
						},
					],
	});
	return {
		environment,
		queryStore: environment.injector.get(QueryStore),
		time,
		provide(children: ReactNode) {
			return createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				children,
			);
		},
	};
}

describe("React resource QueryStore", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("uses stable opaque weak-key identifiers scoped to the store", () => {
		const firstStore = new QueryStore({ time: createTimeForTest() });
		const secondStore = new QueryStore({ time: createTimeForTest() });
		const first = {};
		const second = {};

		expect(typeof firstStore.getWeakKeyId(first)).toBe("string");
		expect(firstStore.getWeakKeyId(first)).toBe(firstStore.getWeakKeyId(first));
		expect(firstStore.getWeakKeyId(first)).not.toBe(
			firstStore.getWeakKeyId(second),
		);
		expect(secondStore.getWeakKeyId(first)).toBe(
			secondStore.getWeakKeyId(first),
		);
	});

	it("shares one pending promise and source waiter for the same snapshot", async () => {
		const harness = createHarness();
		const state = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});
		const valueStream = state[SYMBOL_OBSERVABLE]();
		const valueSubscribe = vi.spyOn(valueStream, "subscribe");
		const changeStream = state.watchStream();
		const changeSubscribe = vi.spyOn(changeStream, "subscribe");
		const snapshot = {
			equals: state.equals,
			get: () => state.get(),
			watchStream: () => changeStream,
			[SYMBOL_OBSERVABLE]: () => valueStream,
		};

		function Probe({ label }: { readonly label: string }) {
			const value = useSuspenseResourceValue(snapshot);
			return createElement("span", null, `${label}:${value}`);
		}

		const view = render(
			harness.provide(
				createElement(
					Suspense,
					{ fallback: createElement("div", null, "loading") },
					createElement(
						Fragment,
						null,
						createElement(Probe, { label: "a" }),
						createElement(Probe, { label: "b" }),
					),
				),
			),
		);

		expect(view.container.textContent).toBe("loading");
		expect(readQueryStorePendingPromises(harness.queryStore)).toHaveLength(1);
		expect(valueSubscribe).toHaveBeenCalledTimes(1);
		expect(changeSubscribe).not.toHaveBeenCalled();

		await act(async () => {
			state.set({ status: ResourceStatus.Resolved, value: "ready" });
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("a:readyb:ready");
		// The one-shot query is released after its first value; each mounted hook
		// observes subsequent Resource snapshots directly.
		expect(valueSubscribe).toHaveBeenCalledTimes(1);
		expect(changeSubscribe).toHaveBeenCalledTimes(2);

		await act(async () => {
			state.set({ status: ResourceStatus.Resolved, value: "updated" });
			await Promise.resolve();
		});
		expect(view.container.textContent).toBe("a:updatedb:updated");
		expect(valueSubscribe).toHaveBeenCalledTimes(1);
		expect(changeSubscribe).toHaveBeenCalledTimes(2);
		view.unmount();
	});

	it("normalizes a Resource and its snapshot signal to one query", async () => {
		const harness = createHarness();
		const state = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});
		using resource = resourceFromSnapshots(() => state.get());

		function ResourceProbe() {
			return createElement("span", null, useSuspenseResourceValue(resource));
		}

		function SnapshotProbe() {
			return createElement(
				"span",
				null,
				useSuspenseResourceValue(resource.snapshot),
			);
		}

		const view = render(
			harness.provide(
				createElement(
					Suspense,
					{ fallback: "loading" },
					createElement(
						Fragment,
						null,
						createElement(ResourceProbe),
						createElement(SnapshotProbe),
					),
				),
			),
		);

		expect(readQueryStorePendingPromises(harness.queryStore)).toHaveLength(1);
		await act(async () => {
			state.set({ status: ResourceStatus.Resolved, value: "shared" });
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(view.container.textContent).toBe("sharedshared");
		view.unmount();
	});

	it("returns stale values for error snapshots", () => {
		const harness = createHarness();
		const snapshot = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Error,
			value: "stale",
			error: new Error("refresh failed"),
		});

		function Probe() {
			return createElement("div", null, useSuspenseResourceValue(snapshot));
		}

		const view = render(harness.provide(createElement(Probe)));
		expect(view.container.textContent).toBe("stale");
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(0);
		view.unmount();
	});

	it("throws loading errors to the nearest ErrorBoundary", () => {
		const harness = createHarness();
		const snapshot = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.LoadingError,
			error: new Error("load failed"),
		});

		function Probe() {
			return createElement("div", null, useSuspenseResourceValue(snapshot));
		}

		const view = render(
			harness.provide(
				createElement(TestErrorBoundary, null, createElement(Probe)),
			),
		);
		expect(view.container.textContent).toBe("load failed");
		view.unmount();
	});

	it("tracks signal dependencies for computed snapshot input", async () => {
		const harness = createHarness();
		const state = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});

		function Probe() {
			return createElement(
				"div",
				null,
				useSuspenseResourceValue(() => state.get(), {
					dependencies: [],
					queryKey: ["computed-state"],
				}),
			);
		}

		const view = render(
			harness.provide(
				createElement(Suspense, { fallback: "loading" }, createElement(Probe)),
			),
		);
		expect(view.container.textContent).toBe("loading");

		await act(async () => {
			state.set({ status: ResourceStatus.Resolved, value: "computed" });
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(view.container.textContent).toBe("computed");
		view.unmount();
	});

	it("replaces computed queries when React dependencies change", () => {
		const harness = createHarness();

		function Probe({ prefix }: { readonly prefix: string }) {
			return createElement(
				"div",
				null,
				useSuspenseResourceValue(
					() => ({
						status: ResourceStatus.Resolved,
						value: `${prefix}:value`,
					}),
					{ dependencies: [prefix], queryKey: ["prefix", prefix] },
				),
			);
		}

		const view = render(harness.provide(createElement(Probe, { prefix: "a" })));
		expect(view.container.textContent).toBe("a:value");
		view.rerender(harness.provide(createElement(Probe, { prefix: "b" })));
		expect(view.container.textContent).toBe("b:value");
		view.unmount();
	});

	it("uses stable key hashing and rejects invalid query keys", () => {
		const harness = createHarness();
		const snapshot = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});

		function Probe({ reversed }: { readonly reversed: boolean }) {
			useSuspenseResourceValue(snapshot, {
				queryKey: [reversed ? { b: "b", a: "a" } : { a: "a", b: "b" }],
			});
			return null;
		}

		const shared = render(
			harness.provide(
				createElement(
					Suspense,
					{ fallback: "loading" },
					createElement(
						Fragment,
						null,
						createElement(Probe, { reversed: false }),
						createElement(Probe, { reversed: true }),
					),
				),
			),
		);
		expect(readQueryStorePendingPromises(harness.queryStore)).toHaveLength(1);
		shared.unmount();

		function InvalidProbe() {
			useSuspenseResourceValue(snapshot, {
				queryKey: [{ invalid: undefined } as never],
			});
			return null;
		}
		const invalid = render(
			harness.provide(
				createElement(TestErrorBoundary, null, createElement(InvalidProbe)),
			),
		);
		expect(invalid.container.textContent).toContain(
			"Query keys must contain only finite JSON-compatible values.",
		);
		expect(
			invalid.container.querySelector("[data-error]")?.textContent,
		).toBeTruthy();
		invalid.unmount();
	});

	it("retains queries through StrictMode churn and collects zero-ref entries", async () => {
		const harness = createHarness({ gcTimeMs: 100 });
		const snapshot = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});

		function Probe() {
			return createElement("div", null, useSuspenseResourceValue(snapshot));
		}

		const view = render(
			harness.provide(
				createElement(
					StrictMode,
					null,
					createElement(
						Suspense,
						{ fallback: "loading" },
						createElement(Probe),
					),
				),
			),
		);
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(1);
		await act(async () => {
			snapshot.set({ status: ResourceStatus.Resolved, value: "ready" });
			await Promise.resolve();
			await Promise.resolve();
		});
		view.unmount();
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(1);

		harness.time.advanceAndFlush(99);
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(1);
		harness.time.advanceAndFlush(1);
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(0);
	});

	it("retains pending queries until settlement by default", async () => {
		const harness = createHarness({ gcTimeMs: 100 });
		const snapshot = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});

		function Probe() {
			return createElement("div", null, useSuspenseResourceValue(snapshot));
		}

		const view = render(
			harness.provide(
				createElement(Suspense, { fallback: "loading" }, createElement(Probe)),
			),
		);
		view.unmount();
		harness.time.advanceAndFlush(100);
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(1);

		await act(async () => {
			snapshot.set({ status: ResourceStatus.Resolved, value: "ready" });
			await Promise.resolve();
			await Promise.resolve();
		});
		harness.time.advanceAndFlush(100);
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(0);
	});

	it("allows pending queries to expire when retention is disabled", async () => {
		const harness = createHarness({ gcTimeMs: 100 });
		const snapshot = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});

		function Probe() {
			return createElement(
				"div",
				null,
				useSuspenseResourceValue(snapshot, { retainWhilePending: false }),
			);
		}

		const view = render(
			harness.provide(
				createElement(Suspense, { fallback: "loading" }, createElement(Probe)),
			),
		);
		view.unmount();
		harness.time.advanceAndFlush(100);
		await Promise.resolve();
		expect(readQueryStoreQueryCount(harness.queryStore)).toBe(0);
	});

	it("disposes the environment query store with SecuritydeptDestroyRef", async () => {
		const time = createTimeForTest();
		const destroyRef = createSecuritydeptDestroyRef();
		const environment = createEnvironmentForReact({
			time,
			providers: [{ provide: SecuritydeptDestroyRef, useValue: destroyRef }],
		});
		const queryStore = environment.injector.get(QueryStore);
		const snapshot = createSignal<ResourceSnapshot<string>>({
			status: ResourceStatus.Loading,
		});

		function Probe() {
			return createElement("div", null, useSuspenseResourceValue(snapshot));
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(Suspense, { fallback: "loading" }, createElement(Probe)),
			),
		);
		view.unmount();
		expect(readQueryStoreQueryCount(queryStore)).toBe(1);
		await act(async () => {
			// Destroy-ref propagation is the lifecycle action under test.
			destroyRef.dispose();
			await Promise.resolve();
		});
		expect(time.pendingCount).toBe(0);
	});

	it("reports invalid computed options as configuration errors", () => {
		const harness = createHarness();

		function Probe() {
			useSuspenseResourceValue(
				() => ({ status: ResourceStatus.Resolved, value: "ready" }),
				{} as never,
			);
			return null;
		}

		let captured: unknown;
		class CaptureBoundary extends TestErrorBoundary {
			static override getDerivedStateFromError(error: unknown) {
				captured = error;
				return { error };
			}
		}

		const view = render(
			harness.provide(
				createElement(CaptureBoundary, null, createElement(Probe)),
			),
		);
		expect(captured).toBeInstanceOf(ClientError);
		expect(captured).toMatchObject({
			kind: "configuration",
			code: "react.query.computed_dependencies_required",
		});
		view.unmount();

		function MissingQueryKeyProbe() {
			useSuspenseResourceValue(
				() => ({ status: ResourceStatus.Resolved, value: "ready" }),
				{ dependencies: [] } as never,
			);
			return null;
		}

		const missingQueryKey = render(
			harness.provide(
				createElement(
					CaptureBoundary,
					null,
					createElement(MissingQueryKeyProbe),
				),
			),
		);
		expect(captured).toMatchObject({
			kind: "configuration",
			code: "react.query.computed_query_key_required",
		});
		missingQueryKey.unmount();
	});
});
