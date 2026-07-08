// @vitest-environment jsdom

import {
	ENVIRONMENT_TOKEN,
	ResourceStatus,
	SecuritydeptInjector,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { SecuritydeptProvider } from "@securitydept/client-react";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetClientRegistry,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
} from "@securitydept/token-set-context-client/test";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useTokenSetClientRegistry } from "../index";

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

function createMockClient(accessToken: string): BaseOidcModeClient {
	return createTokenSetClientForTest({
		authSnapshot: {
			status: ResourceStatus.Resolved,
			value: { tokens: { accessToken }, metadata: {} },
		},
	});
}

describe("TokenSetClientRegistry React adapter", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("registers entries through an externally created Securitydept injector", async () => {
		const client = createMockClient("main-at");
		const entry = createTokenSetClientRegistryEntryForTest({
			clientKey: "main",
			client,
		});
		const environment = createEnvironmentForTest({
			providers: provideTokenSetClientRegistry({ clients: [entry] }),
		});
		let registry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;

		function Probe() {
			registry = useTokenSetClientRegistry();
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(view.container.textContent).toBe("ready");
		const resolvedClient = (
			await registry?.clientRecordFor("main", { initialize: true })
		)?.client;
		expect(await resolvedClient?.authResource.whenValue()).toEqual({
			tokens: { accessToken: "main-at" },
			metadata: {},
		});

		view.unmount();
		expect(() => registryClientIsDisposed(client)).not.toThrow();
	});

	it("creates registry entries inside the injector scope", async () => {
		const client = createMockClient("scoped-at");
		let registry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;
		let factoryCalls = 0;
		const environment = createEnvironmentForTest({
			providers: provideTokenSetClientRegistry({
				createClients: (injector) => {
					factoryCalls++;
					expect(injector.get(ENVIRONMENT_TOKEN)).toBe(environment);
					return [
						createTokenSetClientRegistryEntryForTest({
							clientKey: "scoped",
							client,
						}),
					];
				},
			}),
		});

		function Probe() {
			registry = useTokenSetClientRegistry();
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: environment.injector },
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(factoryCalls).toBe(1);
		expect(
			(await registry?.clientRecordFor("scoped", { initialize: true }))?.client,
		).toBe(client);
		view.unmount();
	});

	it("supports nested registry overrides", async () => {
		let parentRegistry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;
		let childRegistry: TokenSetClientRegistry<BaseOidcModeClient> | undefined;
		const environment = createEnvironmentForTest({
			providers: provideTokenSetClientRegistry({
				clients: [
					createTokenSetClientRegistryEntryForTest({
						clientKey: "main",
						client: createMockClient("parent-at"),
					}),
				],
			}),
		});
		const parentInjector = environment.injector;
		const childInjector = SecuritydeptInjector.fromParentInjector(
			parentInjector,
			provideTokenSetClientRegistry({
				clients: [
					createTokenSetClientRegistryEntryForTest({
						clientKey: "main",
						client: createMockClient("child-at"),
					}),
				],
			}),
		);

		function Probe({ label }: { label: string }) {
			const registry = useTokenSetClientRegistry();
			if (label === "parent") {
				parentRegistry = registry;
			} else {
				childRegistry = registry;
			}
			return createElement("output", null, label);
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{ injector: parentInjector },
				createElement(Probe, { label: "parent" }),
				createElement(
					SecuritydeptProvider,
					{ injector: childInjector },
					createElement(Probe, { label: "child" }),
				),
			),
		);
		await flushMicrotasks();

		expect(view.container.textContent).toBe("parentchild");
		expect(
			await (
				await parentRegistry?.clientRecordFor("main", { initialize: true })
			)?.client.authResource.whenValue(),
		).toEqual({ tokens: { accessToken: "parent-at" }, metadata: {} });
		expect(
			await (
				await childRegistry?.clientRecordFor("main", { initialize: true })
			)?.client.authResource.whenValue(),
		).toEqual({ tokens: { accessToken: "child-at" }, metadata: {} });
		view.unmount();
	});
});

function registryClientIsDisposed(client: BaseOidcModeClient): void {
	client.dispose();
}
