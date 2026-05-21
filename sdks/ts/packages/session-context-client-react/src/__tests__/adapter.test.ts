// @vitest-environment jsdom

import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "@securitydept/client";
import { createInMemoryRecordStore } from "@securitydept/client";
import { createWebClientEnvironment } from "@securitydept/client/web";
import {
	SecuritydeptProvider,
	useReadableSignal,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	SessionContextClient,
	SessionContextControllerStatus,
} from "@securitydept/session-context-client";
import {
	act,
	createElement,
	type ReactElement,
	StrictMode,
	useEffect,
	useRef,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
	createSessionContextController,
	provideSessionContextController,
	SESSION_CONTEXT_CONTROLLER,
	SessionContextController,
} from "../index";

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

function createTestEnvironment(options: {
	transport: HttpTransport;
	sessionStore?: ReturnType<typeof createInMemoryRecordStore>;
}) {
	return createWebClientEnvironment({
		transport: options.transport,
		sessionStore: options.sessionStore,
	});
}

describe("session-context react adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
	});

	it("syncs controller state through SecuritydeptProvider and supports refresh without app glue", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const firstResponse = createDeferredResponse();
		const secondResponse = createDeferredResponse();
		const transport = createQueuedTransport([firstResponse, secondResponse]);
		const observed: string[] = [];
		let refresh: (() => void) | null = null;
		const controller = createSessionContextController({
			config: { baseUrl: "https://auth.example.com" },
			environment: createTestEnvironment({
				transport,
				sessionStore: createInMemoryRecordStore(),
			}),
		});

		function Probe() {
			const injector = useSecuritydeptContext();
			const resolvedController = injector.get(SESSION_CONTEXT_CONTROLLER);
			const state = useReadableSignal(resolvedController.state);
			const principal = state.session?.principal ?? null;

			useEffect(() => {
				refresh = () => {
					void resolvedController.refresh();
				};
				observed.push(
					`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
			}, [principal?.displayName, resolvedController, state]);

			return createElement(
				"output",
				null,
				`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: provideSessionContextController(controller) },
				createElement(Probe),
			),
		);

		act(() => {
			void controller.refresh();
		});

		expect(view.container.textContent).toBe("loading:none");
		expect(observed).toEqual(["ready:none", "loading:none"]);

		await act(async () => {
			firstResponse.resolve({
				status: 200,
				headers: {},
				body: {
					subject: "session-user-1",
					display_name: "Alice",
				},
			});
			await firstResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:Alice");
		expect(observed).toEqual(["ready:none", "loading:none", "ready:Alice"]);
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
					subject: "session-user-2",
					display_name: "Bob",
				},
			});
			await secondResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:Bob");
		expect(observed).toEqual([
			"ready:none",
			"loading:none",
			"ready:Alice",
			"loading:Alice",
			"ready:Bob",
		]);

		view.unmount();
	});

	it("exposes login redirect helpers and transport-bound logout through the controller token", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const requests: HttpRequest[] = [];
		const firstResponse = createDeferredResponse();
		const logoutResponse = createDeferredResponse();
		const transport = createTrackedTransport(requests, [
			firstResponse,
			logoutResponse,
		]);
		const sessionStore = createInMemoryRecordStore();
		const observed: string[] = [];
		const controller = createSessionContextController({
			config: { baseUrl: "https://auth.example.com" },
			environment: createTestEnvironment({ transport, sessionStore }),
		});

		function Probe() {
			const injector = useSecuritydeptContext();
			const resolvedController = injector.get(SESSION_CONTEXT_CONTROLLER);
			const state = useReadableSignal(resolvedController.state);
			const didRun = useRef(false);

			useEffect(() => {
				if (
					state.status !== SessionContextControllerStatus.Loading &&
					!didRun.current
				) {
					didRun.current = true;
					void (async () => {
						await resolvedController.rememberPostAuthRedirect(
							"/entries?tab=all",
						);
						observed.push(await resolvedController.resolveLoginUrl());
						await resolvedController.logout();
						observed.push(await resolvedController.resolveLoginUrl());
					})();
				}
			}, [resolvedController, state]);

			return createElement(
				"output",
				null,
				`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${state.session?.principal.displayName ?? "none"}`,
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: provideSessionContextController(controller) },
				createElement(Probe),
			),
		);

		act(() => {
			void controller.refresh();
		});

		await act(async () => {
			firstResponse.resolve({
				status: 200,
				headers: {},
				body: {
					subject: "session-user-1",
					display_name: "Alice",
				},
			});
			await firstResponse.promise;
			await Promise.resolve();
			await Promise.resolve();
			logoutResponse.resolve({
				status: 200,
				headers: {},
				body: {},
			});
			await logoutResponse.promise;
		});

		expect(observed).toEqual([
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=%2Fentries%3Ftab%3Dall",
			"https://auth.example.com/auth/session/login",
		]);
		expect(requests).toContainEqual(
			expect.objectContaining({
				method: "POST",
				url: "https://auth.example.com/auth/session/logout",
			}),
		);
		expect(view.container.textContent).toBe("ready:none");

		view.unmount();
	});

	it("drops in-flight fetch updates after unmount as its cleanup boundary", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const pendingResponse = createDeferredResponse();
		const transport = createQueuedTransport([pendingResponse]);
		const observed: string[] = [];
		const controller = createSessionContextController({
			config: { baseUrl: "https://auth.example.com" },
			environment: createTestEnvironment({ transport }),
		});

		function Probe() {
			const injector = useSecuritydeptContext();
			const resolvedController = injector.get(SESSION_CONTEXT_CONTROLLER);
			const state = useReadableSignal(resolvedController.state);
			const principal = state.session?.principal ?? null;

			useEffect(() => {
				observed.push(
					`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
			}, [principal?.displayName, state]);

			return null;
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: provideSessionContextController(controller) },
				createElement(Probe),
			),
		);

		act(() => {
			void controller.refresh();
		});

		expect(observed).toEqual(["ready:none", "loading:none"]);

		view.unmount();

		await act(async () => {
			pendingResponse.resolve({
				status: 200,
				headers: {},
				body: {
					subject: "session-user-3",
					display_name: "Carol",
				},
			});
			await pendingResponse.promise;
		});

		expect(observed).toEqual(["ready:none", "loading:none"]);
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
		const firstController = createSessionContextController({
			config: { baseUrl: "https://alpha.example.com" },
			environment: createTestEnvironment({ transport: firstTransport }),
		});
		const secondController = createSessionContextController({
			config: { baseUrl: "https://beta.example.com" },
			environment: createTestEnvironment({ transport: secondTransport }),
		});

		function Probe() {
			const injector = useSecuritydeptContext();
			const controller = injector.get(SESSION_CONTEXT_CONTROLLER);
			const state = useReadableSignal(controller.state);
			const principal = state.session?.principal ?? null;

			useEffect(() => {
				observed.push(
					`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
			}, [principal?.displayName, state]);

			return createElement(
				"output",
				null,
				`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: provideSessionContextController(firstController) },
				createElement(Probe),
			),
		);

		act(() => {
			void firstController.refresh();
		});

		expect(view.container.textContent).toBe("loading:none");
		expect(firstRequests).toEqual([
			expect.objectContaining({
				url: "https://alpha.example.com/auth/session/user-info",
			}),
		]);

		view.rerender(
			createElement(
				SecuritydeptProvider,
				{ providers: provideSessionContextController(secondController) },
				createElement(Probe),
			),
		);

		act(() => {
			void secondController.refresh();
		});

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
					subject: "session-user-stale",
					display_name: "Stale Alice",
				},
			});
			await firstResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:none");
		expect(observed).toEqual([
			"ready:none",
			"loading:none",
			"ready:none",
			"loading:none",
			"ready:none",
		]);

		view.unmount();
	});

	it("coalesces StrictMode initial refresh replay through the controller", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const firstResponse = createDeferredResponse();
		const requests: HttpRequest[] = [];
		const transport = createTrackedTransport(requests, [firstResponse]);
		const observed: string[] = [];
		const controller = createSessionContextController({
			config: { baseUrl: "https://auth.example.com" },
			environment: createTestEnvironment({
				transport,
				sessionStore: createInMemoryRecordStore(),
			}),
		});

		function Probe() {
			const injector = useSecuritydeptContext();
			const resolvedController = injector.get(SESSION_CONTEXT_CONTROLLER);
			const state = useReadableSignal(resolvedController.state);
			const principal = state.session?.principal ?? null;

			useEffect(() => {
				observed.push(
					`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
				);
				if (state.status === SessionContextControllerStatus.Idle) {
					void resolvedController.refresh();
				}
			}, [principal?.displayName, resolvedController, state]);

			return createElement(
				"output",
				null,
				`${state.status === SessionContextControllerStatus.Loading ? "loading" : "ready"}:${principal?.displayName ?? "none"}`,
			);
		}

		const view = render(
			createElement(
				StrictMode,
				null,
				createElement(
					SecuritydeptProvider,
					{ providers: provideSessionContextController(controller) },
					createElement(Probe),
				),
			),
		);

		expect(view.container.textContent).toBe("loading:none");
		expect(requests).toHaveLength(1);
		expect(requests).toEqual([
			expect.objectContaining({
				url: "https://auth.example.com/auth/session/user-info",
			}),
		]);
		expect(observed).toContain("loading:none");

		await act(async () => {
			firstResponse.resolve({
				status: 200,
				headers: {},
				body: {
					subject: "session-user-current",
					display_name: "Current Alice",
				},
			});
			await firstResponse.promise;
		});

		expect(view.container.textContent).toBe("ready:Current Alice");
		expect(observed.at(-1)).toBe("ready:Current Alice");

		view.unmount();
	});

	it("allows hosts to provide an external controller", async () => {
		(
			globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		const response = createDeferredResponse();
		const transport = createQueuedTransport([response]);
		const controller = new SessionContextController({
			client: new SessionContextClient({
				baseUrl: "https://auth.example.com",
			}),
			transport,
		});

		function Probe() {
			const injector = useSecuritydeptContext();
			const resolvedController = injector.get(SESSION_CONTEXT_CONTROLLER);
			const state = useReadableSignal(resolvedController.state);
			useEffect(() => {
				if (state.status === SessionContextControllerStatus.Idle) {
					void resolvedController.refresh();
				}
			}, [resolvedController, state.status]);
			return createElement(
				"output",
				null,
				state.session?.principal.displayName ?? "none",
			);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ providers: provideSessionContextController(controller) },
				createElement(Probe),
			),
		);

		await act(async () => {
			response.resolve({
				status: 200,
				headers: {},
				body: { subject: "session-user-4", display_name: "Dana" },
			});
			await response.promise;
		});

		expect(view.container.textContent).toBe("Dana");
		view.unmount();
	});
});
