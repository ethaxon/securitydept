// @vitest-environment jsdom

import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInitialRef } from "../hooks/use-initial-ref";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	act(() => root.render(element));
	return {
		rerender(nextElement: ReactElement) {
			act(() => root.render(nextElement));
		},
		unmount() {
			act(() => root.unmount());
			container.remove();
		},
	};
}

describe("useInitialRef", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("preserves one initialized ref across renders", () => {
		const initialize = vi.fn(() => ({ id: "initial" }));
		const observedRefs: object[] = [];

		function Probe({ revision }: { readonly revision: number }) {
			const ref = useInitialRef(initialize);
			observedRefs.push(ref);
			return createElement("output", null, `${revision}:${ref.current.id}`);
		}

		const view = render(createElement(Probe, { revision: 1 }));
		view.rerender(createElement(Probe, { revision: 2 }));

		expect(initialize).toHaveBeenCalledOnce();
		expect(observedRefs[1]).toBe(observedRefs[0]);
		view.unmount();
	});

	it("does not treat an initialized null value as uninitialized", () => {
		const initialize = vi.fn(() => null);

		function Probe({ revision }: { readonly revision: number }) {
			const ref = useInitialRef(initialize);
			return createElement(
				"output",
				null,
				`${revision}:${String(ref.current)}`,
			);
		}

		const view = render(createElement(Probe, { revision: 1 }));
		view.rerender(createElement(Probe, { revision: 2 }));

		expect(initialize).toHaveBeenCalledOnce();
		view.unmount();
	});
});
