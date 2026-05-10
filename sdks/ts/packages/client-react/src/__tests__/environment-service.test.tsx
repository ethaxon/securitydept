// @vitest-environment jsdom

import {
	ClientEnvironmentService,
	createBrowserPageClientEnvironment,
	createWebClientEnvironment,
	deriveClientEnvironment,
	type PageLocationHistoryCapability,
	type WebClientEnvironment,
} from "@securitydept/client/web";
import {
	ClientEnvironmentServiceProvider,
	useClientEnvironmentService,
	usePageClientEnvironment,
} from "@securitydept/client-react";
import {
	act,
	Component,
	createElement,
	type ReactElement,
	type ReactNode,
	Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

function createTransport() {
	return {
		execute: vi.fn(async () => ({
			status: 200,
			headers: {},
			body: null,
		})),
	};
}

function createScheduler() {
	return {
		setTimeout() {
			return { cancel() {} };
		},
	};
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {
		promise,
		resolve,
		reject,
	};
}

function createPageCapability(): PageLocationHistoryCapability {
	return {
		location: {
			href: "https://app.example.com/playground/token-set/frontend-mode",
			hash: "",
			pathname: "/playground/token-set/frontend-mode",
			search: "",
		},
		history: {
			replaceState() {},
		},
	};
}

function createEnvironment(): WebClientEnvironment {
	return createWebClientEnvironment({
		transport: createTransport(),
		scheduler: createScheduler(),
		clock: { now: () => Date.now() },
	});
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
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

async function flushMicrotasks() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

interface TestErrorBoundaryProps {
	children?: ReactNode;
	onError?: (error: unknown) => void;
	renderError: (error: unknown) => ReactNode;
}

interface TestErrorBoundaryState {
	error: unknown | null;
}

class TestErrorBoundary extends Component<
	TestErrorBoundaryProps,
	TestErrorBoundaryState
> {
	override state: TestErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: unknown): TestErrorBoundaryState {
		return { error };
	}

	override componentDidCatch(error: unknown) {
		this.props.onError?.(error);
	}

	override render() {
		if (this.state.error !== null) {
			return this.props.renderError(this.state.error);
		}

		return this.props.children;
	}
}

describe("client-react environment-service adapter", () => {
	afterEach(() => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = undefined;
		document.body.innerHTML = "";
	});

	it("uses the provider-scoped service instance and resolves page environments through Suspense", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const deferred = createDeferred<WebClientEnvironment>();
		const createPageEnvironment = vi.fn(
			(webEnvironment: WebClientEnvironment) =>
				createBrowserPageClientEnvironment({
					pageCapability: createPageCapability(),
					...deriveClientEnvironment(webEnvironment),
				}),
		);
		const service = new ClientEnvironmentService({
			createClientEnvironment: () => deferred.promise,
			createPageEnvironment,
		});
		let observedService: unknown;

		function Probe() {
			observedService = useClientEnvironmentService();
			const environment = usePageClientEnvironment();
			return createElement("div", null, environment.location.href);
		}

		const view = render(
			createElement(
				ClientEnvironmentServiceProvider,
				{ service },
				createElement(
					Suspense,
					{ fallback: createElement("div", null, "loading") },
					createElement(Probe),
				),
			),
		);

		expect(view.container.textContent).toBe("loading");

		deferred.resolve(createEnvironment());
		await flushMicrotasks();

		expect(observedService).toBe(service);
		expect(createPageEnvironment).toHaveBeenCalledTimes(1);
		expect(view.container.textContent).toBe(
			"https://app.example.com/playground/token-set/frontend-mode",
		);

		view.unmount();
	});

	it("surfaces rejected page environment reads through the nearest error boundary", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const deferred = createDeferred<WebClientEnvironment>();
		const rejectedError = new Error("environment materialization failed");
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const service = new ClientEnvironmentService({
			createClientEnvironment: () => deferred.promise,
			createPageEnvironment: (webEnvironment) =>
				createBrowserPageClientEnvironment({
					pageCapability: createPageCapability(),
					...deriveClientEnvironment(webEnvironment),
				}),
		});
		const onError = vi.fn();

		function Probe() {
			usePageClientEnvironment();
			return createElement("div", null, "ready");
		}

		const view = render(
			createElement(
				TestErrorBoundary,
				{
					onError,
					renderError: (error) =>
						createElement("div", null, (error as Error).message),
				},
				createElement(
					ClientEnvironmentServiceProvider,
					{ service },
					createElement(
						Suspense,
						{ fallback: createElement("div", null, "loading") },
						createElement(Probe),
					),
				),
			),
		);

		try {
			expect(view.container.textContent).toBe("loading");

			deferred.reject(rejectedError);
			await flushMicrotasks();

			expect(onError).toHaveBeenCalledWith(rejectedError);
			expect(view.container.textContent).toBe(
				"environment materialization failed",
			);
		} finally {
			consoleError.mockRestore();
			view.unmount();
		}
	});
});
