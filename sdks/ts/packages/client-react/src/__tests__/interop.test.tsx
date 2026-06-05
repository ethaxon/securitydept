// @vitest-environment jsdom

import {
	createEventSubject,
	createResource,
	createSignal,
	type ObserverTrait,
	ResourceStatus,
	type SubscriptionTrait,
	SYMBOL_OBSERVABLE,
} from "@securitydept/client";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	useEventStream,
	useInteropObservable,
	useResourceSnapshot,
	useResourceValue,
	useSignal,
} from "../interop";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return {
		container,
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

describe("client-react interop", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("reads the initial signal snapshot and re-renders on updates", async () => {
		const source = createSignal("initial");

		function Probe() {
			const value = useSignal(source);
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("initial");

		await act(async () => {
			source.set("next");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("next");
		view.unmount();
	});

	it("unsubscribes from the signal when the component unmounts", () => {
		const unsubscribe = vi.fn();
		const subscription = { unsubscribe };
		const watchStream = {
			subscribe: vi.fn(() => subscription),
			[SYMBOL_OBSERVABLE]: () => watchStream,
		};
		const source = {
			equals: Object.is,
			get: () => "stable",
			watchStream: vi.fn(() => watchStream),
			[SYMBOL_OBSERVABLE]: vi.fn(),
		};

		function Probe() {
			const value = useSignal(source);
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(source.watchStream).toHaveBeenCalledTimes(1);
		view.unmount();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("uses the same snapshot during SSR", () => {
		const source = createSignal("client");

		function Probe() {
			const value = useSignal(source);
			return createElement("div", null, value);
		}

		expect(renderToString(createElement(Probe))).toContain("client");
	});

	it("reads resource snapshots and re-renders on updates", async () => {
		const response = createEventSubject<string>();
		const resource = createResource<string>({
			stream: () => response,
		});

		function Probe() {
			const snapshot = useResourceSnapshot(resource);
			return createElement("div", null, snapshot.status);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe(ResourceStatus.Loading);

		await act(async () => {
			response.next("ready");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe(ResourceStatus.Resolved);
		view.unmount();
		resource.dispose();
	});

	it("reads resource values with an initial value until resolved", async () => {
		const response = createEventSubject<string>();
		const resource = createResource<string>({
			stream: () => response,
		});

		function Probe() {
			const value = useResourceValue(resource, { initialValue: "loading" });
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("loading");

		await act(async () => {
			response.next("ready");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("ready");
		view.unmount();
		resource.dispose();
	});

	it("reads interop observable initialValue and later emissions", async () => {
		const subject = createEventSubject<string>();

		function Probe() {
			const value = useInteropObservable<string, string>(subject, {
				initialValue: "loading",
			});
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("loading");

		await act(async () => {
			subject.next("ready");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("ready");
		view.unmount();
	});

	it("requires synchronous interop observable emissions when requested", () => {
		const source = createSignal("sync");

		function Probe() {
			const value = useInteropObservable(source, { requireSync: true });
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("sync");
		view.unmount();
	});

	it("throws when requireSync source does not emit synchronously", () => {
		const source = createEventSubject<string>();

		function Probe() {
			useInteropObservable(source, { requireSync: true });
			return createElement("div");
		}

		expect(() => render(createElement(Probe))).toThrow(
			/useInteropObservable\(\) requires a synchronous emission/,
		);
	});

	it("accepts plain SubscribableTrait sources", async () => {
		let observer: Partial<ObserverTrait<string>> | undefined;
		const source = {
			subscribe(
				nextObserver: Partial<ObserverTrait<string>>,
			): SubscriptionTrait {
				observer = nextObserver;
				return { unsubscribe: vi.fn() };
			},
		};

		function Probe() {
			const value = useInteropObservable(source, { initialValue: "pending" });
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("pending");

		await act(async () => {
			observer?.next?.("plain");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("plain");
		view.unmount();
	});

	it("accepts InteropObservableTrait sources", async () => {
		const source = createSignal("first");

		function Probe() {
			const value = useInteropObservable(
				{
					[SYMBOL_OBSERVABLE]: () => source[SYMBOL_OBSERVABLE](),
				},
				{ requireSync: true },
			);
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("first");

		await act(async () => {
			source.set("second");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("second");
		view.unmount();
	});

	it("subscribes to events only while enabled and cleans up on unmount", async () => {
		const subject = createEventSubject<string>();
		const received: string[] = [];

		function Probe(props: { enabled?: boolean }) {
			useEventStream(
				subject,
				(event: string) => {
					received.push(event);
				},
				{ enabled: props.enabled },
			);
			return createElement("div");
		}

		const view = render(createElement(Probe, { enabled: false }));
		await act(async () => {
			subject.next("ignored");
			await Promise.resolve();
		});
		expect(received).toEqual([]);

		act(() => {
			view.unmount();
		});

		const secondView = render(createElement(Probe, { enabled: true }));
		await act(async () => {
			subject.next("handled");
			await Promise.resolve();
		});
		expect(received).toEqual(["handled"]);

		secondView.unmount();
		await act(async () => {
			subject.next("after-unmount");
			await Promise.resolve();
		});
		expect(received).toEqual(["handled"]);
	});
});
