// @vitest-environment jsdom

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "@securitydept/client";
import { createInMemoryRecordStore } from "@securitydept/client";
import {
	SessionContextProvider,
	type SessionContextProviderProps,
	useSessionContext,
	useSessionPrincipal,
} from "@securitydept/session-context-client-react";
import {
	act,
	createElement,
	type ReactElement,
	StrictMode,
	useEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

function render(element: ReactElement) {
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root: Root = createRoot(container);

	act(() => {
		root.render(element);
	});

	return {
		container,
		rerender(nextElement: ReactElement) {
			act(() => {
				root.render(nextElement);
			});
		},
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	};
}

function createDeferredResponse() {
	let resolve!: (response: HttpResponse) => void;
	const promise = new Promise<HttpResponse>((res) => {
		resolve = res;
	});

	return { promise, resolve };
}

function createQueuedTransport(
	queuedResponses: Array<ReturnType<typeof createDeferredResponse>>,
): HttpTransport {
	return {
		async execute(_request: HttpRequest) {
			const next = queuedResponses.shift();
			if (!next) {
				throw new Error("Expected queued session response");
			}
			return await next.promise;
		},
	};
}

function createTrackedTransport(
	requests: HttpRequest[],
	queuedResponses: Array<ReturnType<typeof createDeferredResponse>>,
): HttpTransport {
	return {
		async execute(request: HttpRequest) {
			requests.push(request);
			const next = queuedResponses.shift();
			if (!next) {
				throw new Error("Expected queued session response");
			}
			return await next.promise;
		},
	};
}

describe("session-context react adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("syncs provider fetch state into hooks and supports refresh without app glue", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const firstResponse = createDeferredResponse();
		const secondResponse = createDeferredResponse();
		const transport = createQueuedTransport([firstResponse, secondResponse]);
		const observed: string[] = [];
		let refresh: (() => void) | null = null;

		function Probe() {
			const value = useSessionContext();
			const principal = useSessionPrincipal();

			useEffect(() => {
				refresh = value.refresh;
				observed.push(
					`${value.loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
			}, [principal?.displayName, value]);

			return createElement(
				"output",
				null,
				`${value.loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
			);
		}

		const providerProps = {
			config: { baseUrl: "https://auth.example.com" },
			transport,
			sessionStore: createInMemoryRecordStore(),
		} satisfies Omit<SessionContextProviderProps, "children">;

		const view = render(
			createElement(
				SessionContextProvider,
				providerProps as SessionContextProviderProps,
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("loading:none");
		expect(observed).toEqual(["loading:none"]);

		await act(async () => {
			firstResponse.resolve({
				status: 200,
				headers: {},
				body: {
					display_name: "Alice",
				},
			});
			await firstResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:Alice");
		expect(observed).toEqual(["loading:none", "ready:Alice"]);
		expect(refresh).not.toBeNull();

		act(() => {
			refresh?.();
		});

		expect(view.container.textContent).toBe("loading:Alice");

		await act(async () => {
			secondResponse.resolve({
				status: 200,
				headers: {},
				body: {
					display_name: "Bob",
				},
			});
			await secondResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:Bob");
		expect(observed).toEqual([
			"loading:none",
			"ready:Alice",
			"loading:Alice",
			"ready:Bob",
		]);

		view.unmount();
	});

	it("drops in-flight fetch updates after unmount as its cleanup boundary", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const pendingResponse = createDeferredResponse();
		const transport = createQueuedTransport([pendingResponse]);
		const observed: string[] = [];

		function Probe() {
			const { loading } = useSessionContext();
			const principal = useSessionPrincipal();

			useEffect(() => {
				observed.push(
					`${loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
			}, [loading, principal?.displayName]);

			return null;
		}

		const providerProps = {
			config: { baseUrl: "https://auth.example.com" },
			transport,
		} satisfies Omit<SessionContextProviderProps, "children">;

		const view = render(
			createElement(
				SessionContextProvider,
				providerProps as SessionContextProviderProps,
				createElement(Probe),
			),
		);

		expect(observed).toEqual(["loading:none"]);

		view.unmount();

		await act(async () => {
			pendingResponse.resolve({
				status: 200,
				headers: {},
				body: {
					display_name: "Carol",
				},
			});
			await pendingResponse.promise;
		});

		expect(observed).toEqual(["loading:none"]);
	});

	it("realigns to the new provider lifecycle and drops stale results after reconfigure", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const firstRequests: HttpRequest[] = [];
		const secondRequests: HttpRequest[] = [];
		const firstResponse = createDeferredResponse();
		const secondResponse = createDeferredResponse();
		const firstTransport = createTrackedTransport(firstRequests, [
			firstResponse,
		]);
		const secondTransport = createTrackedTransport(secondRequests, [
			secondResponse,
		]);
		const observed: string[] = [];

		function Probe() {
			const { loading } = useSessionContext();
			const principal = useSessionPrincipal();

			useEffect(() => {
				observed.push(
					`${loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
			}, [loading, principal?.displayName]);

			return createElement(
				"output",
				null,
				`${loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
			);
		}

		const initialProps = {
			config: { baseUrl: "https://alpha.example.com" },
			transport: firstTransport,
		} satisfies Omit<SessionContextProviderProps, "children">;

		const view = render(
			createElement(
				SessionContextProvider,
				initialProps as SessionContextProviderProps,
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("loading:none");
		expect(firstRequests).toEqual([
			expect.objectContaining({
				url: "https://alpha.example.com/auth/session/user-info",
			}),
		]);

		const reconfiguredProps = {
			config: { baseUrl: "https://beta.example.com" },
			transport: secondTransport,
		} satisfies Omit<SessionContextProviderProps, "children">;

		view.rerender(
			createElement(
				SessionContextProvider,
				reconfiguredProps as SessionContextProviderProps,
				createElement(Probe),
			),
		);

		expect(view.container.textContent).toBe("loading:none");
		expect(secondRequests).toEqual([
			expect.objectContaining({
				url: "https://beta.example.com/auth/session/user-info",
			}),
		]);

		await act(async () => {
			secondResponse.resolve({
				status: 401,
				headers: {},
				body: null,
			});
			await secondResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:none");

		await act(async () => {
			firstResponse.resolve({
				status: 200,
				headers: {},
				body: {
					display_name: "Stale Alice",
				},
			});
			await firstResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:none");
		expect(observed).toEqual(["loading:none", "ready:none"]);

		view.unmount();
	});

	it("keeps the current StrictMode fetch lifecycle and drops stale remount results", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const firstResponse = createDeferredResponse();
		const secondResponse = createDeferredResponse();
		const requests: HttpRequest[] = [];
		const transport = createTrackedTransport(requests, [
			firstResponse,
			secondResponse,
		]);
		const observed: string[] = [];

		function Probe() {
			const { loading } = useSessionContext();
			const principal = useSessionPrincipal();

			useEffect(() => {
				observed.push(
					`${loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
			}, [loading, principal?.displayName]);

			return createElement(
				"output",
				null,
				`${loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
			);
		}

		const providerProps = {
			config: { baseUrl: "https://auth.example.com" },
			transport,
			sessionStore: createInMemoryRecordStore(),
		} satisfies Omit<SessionContextProviderProps, "children">;

		const view = render(
			createElement(
				StrictMode,
				null,
				createElement(
					SessionContextProvider,
					providerProps as SessionContextProviderProps,
					createElement(Probe),
				),
			),
		);

		expect(view.container.textContent).toBe("loading:none");
		expect(requests).toHaveLength(2);
		expect(requests).toEqual([
			expect.objectContaining({
				url: "https://auth.example.com/auth/session/user-info",
			}),
			expect.objectContaining({
				url: "https://auth.example.com/auth/session/user-info",
			}),
		]);
		expect(observed).toEqual(["loading:none", "loading:none"]);

		await act(async () => {
			secondResponse.resolve({
				status: 200,
				headers: {},
				body: {
					display_name: "Current Alice",
				},
			});
			await secondResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:Current Alice");
		expect(observed.at(-1)).toBe("ready:Current Alice");

		await act(async () => {
			firstResponse.resolve({
				status: 200,
				headers: {},
				body: {
					display_name: "Stale Alice",
				},
			});
			await firstResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:Current Alice");
		expect(observed.at(-1)).toBe("ready:Current Alice");

		view.unmount();
	});
});
