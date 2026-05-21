// @vitest-environment jsdom

import {
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	SecuritydeptInjector,
	type SecuritydeptInjectorTrait,
} from "@securitydept/client/injection";
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "../injection/index";

const LABEL_TOKEN = new SecuritydeptInjectionToken<string>("LABEL_TOKEN");

function render(element: React.ReactElement) {
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

class TestErrorBoundary extends Component<
	{
		children?: ReactNode;
		renderError: (error: unknown) => ReactNode;
	},
	{ error: unknown | null }
> {
	override state = { error: null };

	static getDerivedStateFromError(error: unknown) {
		return { error };
	}

	override render() {
		if (this.state.error !== null) {
			return this.props.renderError(this.state.error);
		}

		return this.props.children;
	}
}

describe("client-react unified Securitydept context", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("creates a root injector from providers", () => {
		function Probe() {
			const injector = useSecuritydeptContext();
			return createElement("div", null, injector.get(LABEL_TOKEN));
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [{ provide: LABEL_TOKEN, useValue: "root" }] },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("root");
		view.unmount();
	});

	it("supports nested provider overrides", () => {
		function Probe() {
			const injector = useSecuritydeptContext();
			return createElement("div", null, injector.get(LABEL_TOKEN));
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: [{ provide: LABEL_TOKEN, useValue: "parent" }] },
				createElement(
					SecuritydeptProvider,
					{ providers: [{ provide: LABEL_TOKEN, useValue: "child" }] },
					createElement(Probe),
				),
			),
		);

		expect(view.container.textContent).toBe("child");
		view.unmount();
	});

	it("prefers an explicit injector over providers", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: LABEL_TOKEN, useValue: "explicit" },
		]);

		function Probe() {
			const resolvedInjector = useSecuritydeptContext();
			return createElement("div", null, resolvedInjector.get(LABEL_TOKEN));
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					injector,
					providers: [{ provide: LABEL_TOKEN, useValue: "ignored" }],
				},
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("explicit");
		view.unmount();
	});

	it("derives from an explicit parentInjector", () => {
		const parentInjector = SecuritydeptInjector.resolveAndCreate([
			{ provide: LABEL_TOKEN, useValue: "parent" },
		]);

		function Probe() {
			const injector = useSecuritydeptContext();
			return createElement("div", null, injector.get(LABEL_TOKEN));
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ parentInjector },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("parent");
		view.unmount();
	});

	it("accepts arbitrary SecuritydeptInjectorTrait as parentInjector", () => {
		const parentInjector: SecuritydeptInjectorTrait = {
			get(token, notFoundValue?) {
				if (token === LABEL_TOKEN) {
					return "duck-parent";
				}
				// biome-ignore lint/complexity/noArguments: Overloads are more ergonomic for the common non-optional case.
				if (arguments.length === 2) {
					return notFoundValue as string;
				}
				throw new Error("missing");
			},
		};

		function Probe() {
			const injector = useSecuritydeptContext();
			return createElement("div", null, injector.get(LABEL_TOKEN));
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ parentInjector },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("duck-parent");
		view.unmount();
	});

	it("fails fast when no SecuritydeptProvider is present", () => {
		function Probe() {
			useSecuritydeptContext();
			return createElement("div", null, "ready");
		}

		const view = render(
			createElement(
				TestErrorBoundary,
				{
					renderError: (error) =>
						createElement("div", null, (error as Error).message),
				},
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe(
			"[useSecuritydeptContext] No SecuritydeptProvider found in the component tree.",
		);
		view.unmount();
	});

	it("provides a destroy ref by default and fires it on unmount", () => {
		const cleanup = vi.fn();

		function Probe() {
			const injector = useSecuritydeptContext();
			const destroyRef = injector.get(SecuritydeptDestroyRef);
			destroyRef.onDestroy(cleanup);
			return createElement(
				"div",
				null,
				destroyRef.destroyed ? "destroyed" : "live",
			);
		}

		const view = render(
			createElement(SecuritydeptProvider, null, createElement(Probe)),
		);

		expect(view.container.textContent).toBe("live");
		view.unmount();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it("can disable automatic destroy ref creation", () => {
		function Probe() {
			const injector = useSecuritydeptContext();
			const destroyRef = injector.get(SecuritydeptDestroyRef, null);
			return createElement(
				"div",
				null,
				destroyRef === null ? "missing" : "present",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ autoCreateDestroyRef: false },
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("missing");
		view.unmount();
	});

	it("still layers a destroy ref over an explicit injector", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: LABEL_TOKEN, useValue: "explicit" },
		]);

		function Probe() {
			const resolvedInjector = useSecuritydeptContext();
			return createElement(
				"div",
				null,
				`${resolvedInjector.get(LABEL_TOKEN)}:${resolvedInjector.get(SecuritydeptDestroyRef).destroyed ? "destroyed" : "live"}`,
			);
		}

		const view = render(
			createElement(SecuritydeptProvider, { injector }, createElement(Probe)),
		);

		expect(view.container.textContent).toBe("explicit:live");
		view.unmount();
	});
});
