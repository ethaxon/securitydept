// @vitest-environment jsdom

import {
	createSignal,
	ResourceStatus,
	resourceFromSnapshots,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import {
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import { act, createElement, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "../index";

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
	const disposed = createSignal(false);
	const isAuthenticatedSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: true,
	} as const);
	const isAuthenticated = resourceFromSnapshots(() =>
		isAuthenticatedSnapshot.get(),
	);
	const authSnapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: { tokens: { accessToken } },
	} as const);
	const authResource = resourceFromSnapshots(() => authSnapshot.get());
	return {
		isAuthenticated,
		authSnapshot,
		authResource,
		dispose: () => disposed.set(true),
		[SYMBOL_DISPOSE]: () => disposed.set(true),
	} as unknown as BaseOidcModeClient;
}

function createEntry(
	clientKey: string,
	client: BaseOidcModeClient,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory: () => client,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackPath: undefined,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

describe("token-set React client registry service", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("registers entries through Securitydept DI and disposes with the React scope", async () => {
		const environment = createEnvironmentForTest();
		const client = createMockClient("main-at");
		const entry = createEntry("main", client);
		let registry: TokenSetClientRegistryService | undefined;

		function Probe() {
			registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY);
			return createElement("output", null, "ready");
		}

		const view = render(
			createElement(
				SecuritydeptProvider,
				{
					parentInjector: environment.injector,
					providers: [...provideTokenSetClientRegistry({ clients: [entry] })],
				},
				createElement(Probe),
			),
		);
		await flushMicrotasks();

		expect(view.container.textContent).toBe("ready");
		const resolvedClient = (await registry?.initialize("main"))?.client;
		expect(await resolvedClient?.authResource.whenValue()).toEqual({
			tokens: { accessToken: "main-at" },
		});

		view.unmount();
		expect(() => registryClientIsDisposed(client)).not.toThrow();
	});

	it("supports nested registry overrides", async () => {
		const environment = createEnvironmentForTest();
		let parentRegistry: TokenSetClientRegistryService | undefined;
		let childRegistry: TokenSetClientRegistryService | undefined;

		function Probe({ label }: { label: string }) {
			const registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY);
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
				{
					parentInjector: environment.injector,
					providers: [
						...provideTokenSetClientRegistry({
							clients: [createEntry("main", createMockClient("parent-at"))],
						}),
					],
				},
				createElement(Probe, { label: "parent" }),
				createElement(
					SecuritydeptProvider,
					{
						providers: [
							...provideTokenSetClientRegistry({
								clients: [createEntry("main", createMockClient("child-at"))],
							}),
						],
					},
					createElement(Probe, { label: "child" }),
				),
			),
		);
		await flushMicrotasks();

		expect(view.container.textContent).toBe("parentchild");
		expect(
			await (
				await parentRegistry?.initialize("main")
			)?.client.authResource.whenValue(),
		).toEqual({ tokens: { accessToken: "parent-at" } });
		expect(
			await (
				await childRegistry?.initialize("main")
			)?.client.authResource.whenValue(),
		).toEqual({ tokens: { accessToken: "child-at" } });
		view.unmount();
	});
});

function registryClientIsDisposed(client: BaseOidcModeClient): void {
	client.dispose();
}
