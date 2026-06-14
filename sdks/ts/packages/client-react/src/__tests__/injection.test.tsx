// @vitest-environment jsdom

import {
	createSecuritydeptDestroyRef,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	SecuritydeptInjector,
	type SecuritydeptInjectorTrait,
} from "@securitydept/client";
import { act, Component, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SecuritydeptProvider,
	type SecuritydeptProviderProps,
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

	it("provides an injector created outside the React tree", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: LABEL_TOKEN, useValue: "root" },
		]);

		function Probe() {
			return createElement(
				"div",
				null,
				useSecuritydeptContext().get(LABEL_TOKEN),
			);
		}

		const view = render(
			createElement(SecuritydeptProvider, { injector }, createElement(Probe)),
		);

		expect(view.container.textContent).toBe("root");
		view.unmount();
	});

	it("supports nested providers with injectors created outside React", () => {
		const parentInjector = SecuritydeptInjector.resolveAndCreate([
			{ provide: LABEL_TOKEN, useValue: "parent" },
		]);
		const childInjector = SecuritydeptInjector.fromParentInjector(
			parentInjector,
			[{ provide: LABEL_TOKEN, useValue: "child" }],
		);

		function Probe() {
			const injector = useSecuritydeptContext();
			return createElement("div", null, injector.get(LABEL_TOKEN));
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: parentInjector },
				createElement(
					SecuritydeptProvider,
					{ injector: childInjector },
					createElement(Probe),
				),
			),
		);

		expect(view.container.textContent).toBe("child");
		view.unmount();
	});

	it("uses an explicit injector without creating an inline child injector", () => {
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
				},
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("explicit");
		view.unmount();
	});

	it("requires an injector and rejects inline injector construction props", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([]);
		const acceptProviderProps = (_props: SecuritydeptProviderProps) => {};

		// @ts-expect-error `injector` is required.
		acceptProviderProps({});

		acceptProviderProps({
			injector,
			// @ts-expect-error Provider does not accept inline dependency providers.
			providers: [{ provide: LABEL_TOKEN, useValue: "ignored" }],
		});

		acceptProviderProps({
			injector,
			// @ts-expect-error Provider does not derive child injectors.
			parentInjector: injector,
		});

		// @ts-expect-error Provider does not own an automatic destroy lifecycle.
		acceptProviderProps({ injector, autoCreateDestroyRef: true });
	});

	it("accepts a child injector created before render", () => {
		const parentInjector = SecuritydeptInjector.resolveAndCreate([
			{ provide: LABEL_TOKEN, useValue: "parent" },
		]);
		const injector = SecuritydeptInjector.fromParentInjector(
			parentInjector,
			[],
		);

		function Probe() {
			const injector = useSecuritydeptContext();
			return createElement("div", null, injector.get(LABEL_TOKEN));
		}

		const view = render(
			createElement(SecuritydeptProvider, { injector }, createElement(Probe)),
		);

		expect(view.container.textContent).toBe("parent");
		view.unmount();
	});

	it("accepts an arbitrary SecuritydeptInjectorTrait", () => {
		const injector: SecuritydeptInjectorTrait = {
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
			createElement(SecuritydeptProvider, { injector }, createElement(Probe)),
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

	it("does not control the lifecycle of dependencies in the injector", () => {
		const cleanup = vi.fn();
		const destroyRef = createSecuritydeptDestroyRef();
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: SecuritydeptDestroyRef, useValue: destroyRef },
		]);
		destroyRef.onDestroy(cleanup);

		function Probe() {
			return createElement("div", null, "live");
		}

		const view = render(
			createElement(SecuritydeptProvider, { injector }, createElement(Probe)),
		);

		expect(view.container.textContent).toBe("live");
		view.unmount();
		expect(cleanup).not.toHaveBeenCalled();
		destroyRef.dispose();
		expect(cleanup).toHaveBeenCalledOnce();
	});
});
