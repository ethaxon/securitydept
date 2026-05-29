// @vitest-environment jsdom

import {
	createEventSubject,
	createReplaySignal,
	createSignal,
	type ObserverTrait,
	type SubscriptionTrait,
	SYMBOL_OBSERVABLE,
} from "@securitydept/client";
import { act, createElement, type ReactElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	useEventStream,
	useInteropObservable,
	useReadableSignalValue,
	useReplaySignalValue,
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
			const value = useReadableSignalValue(source);
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
		const source = {
			get: () => "stable",
			notify: vi.fn(() => unsubscribe),
		};

		function Probe() {
			const value = useReadableSignalValue(source);
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(source.notify).toHaveBeenCalledTimes(1);
		view.unmount();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("uses the same snapshot during SSR", () => {
		const source = createSignal("client");

		function Probe() {
			const value = useReadableSignalValue(source);
			return createElement("div", null, value);
		}

		expect(renderToString(createElement(Probe))).toContain("client");
	});

	it("reads the current replay signal value", async () => {
		const source = createReplaySignal<string>();
		source.setValue("client");

		function Probe() {
			const value = useReplaySignalValue(source);
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("client");
		view.unmount();
	});

	it("uses the replay initialValue until the first value arrives", async () => {
		const source = createReplaySignal<string>();

		function Probe() {
			const value = useReplaySignalValue(source, { initialValue: "loading" });
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(view.container.textContent).toBe("loading");

		await act(async () => {
			source.setValue("ready");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("ready");
		view.unmount();
	});

	it("suspends replay signals without an initialValue until a value is available", async () => {
		const source = createReplaySignal<string>();

		function Probe() {
			const value = useReplaySignalValue(source);
			return createElement("div", null, value);
		}

		const view = render(
			createElement(
				Suspense,
				{ fallback: createElement("div", null, "pending") },
				createElement(Probe),
			),
		);
		expect(view.container.textContent).toBe("pending");

		await act(async () => {
			source.setValue("resolved");
			await Promise.resolve();
		});

		expect(view.container.textContent).toBe("resolved");
		view.unmount();
	});

	it("re-suspends when switching to another replay signal without a value", async () => {
		const ready = createReplaySignal<string>();
		ready.setValue("first");
		const pending = createReplaySignal<string>();

		function Probe(props: { source: typeof ready }) {
			const value = useReplaySignalValue(props.source);
			return createElement("div", null, value);
		}

		const view = render(
			createElement(
				Suspense,
				{ fallback: createElement("div", null, "pending") },
				createElement(Probe, { source: ready }),
			),
		);
		expect(view.container.textContent).toBe("first");

		await act(async () => {
			view.unmount();
			await Promise.resolve();
		});

		const switchedView = render(
			createElement(
				Suspense,
				{ fallback: createElement("div", null, "pending") },
				createElement(Probe, { source: pending }),
			),
		);
		expect(switchedView.container.textContent).toBe("pending");

		await act(async () => {
			pending.setValue("second");
			await Promise.resolve();
		});

		expect(switchedView.container.textContent).toBe("second");
		switchedView.unmount();
	});

	it("reads interop observable initialValue and later emissions", async () => {
		const subject = createEventSubject<string>();

		function Probe() {
			const value = useInteropObservable(subject, { initialValue: "loading" });
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
				(event) => {
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
