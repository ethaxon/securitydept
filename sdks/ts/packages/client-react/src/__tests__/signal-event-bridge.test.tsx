// @vitest-environment jsdom

import {
	createEventSubject,
	createReplaySignal,
	createSignal,
} from "@securitydept/client";
import { act, createElement, type ReactElement, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	useEventStream,
	useReadableSignal,
	useReplaySignalValue,
} from "../signal-event-bridge";

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

describe("client-react signal / event bridge", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("reads the initial signal snapshot and re-renders on updates", async () => {
		const source = createSignal("initial");

		function Probe() {
			const value = useReadableSignal(source);
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
			subscribe: vi.fn(() => unsubscribe),
		};

		function Probe() {
			const value = useReadableSignal(source);
			return createElement("div", null, value);
		}

		const view = render(createElement(Probe));
		expect(source.subscribe).toHaveBeenCalledTimes(1);
		view.unmount();
		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it("uses the same snapshot during SSR", () => {
		const source = createSignal("client");

		function Probe() {
			const value = useReadableSignal(source);
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
