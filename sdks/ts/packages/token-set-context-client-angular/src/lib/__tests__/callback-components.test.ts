// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import {
	createSignal,
	type FoundationEnvironment,
	ResourceStatus,
	type RouterTrait,
	resourceFromSnapshots,
	SYMBOL_DISPOSE,
	UriReferenceString,
} from "@securitydept/client";
import { ENVIRONMENT } from "@securitydept/client-angular";
import {
	BackendOidcModeClient,
	BackendOidcModeCompatFragmentKind,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	type FrontendOidcModeCallbackResult,
	FrontendOidcModeClient,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	createTokenSetClientRegistry,
	TokenSetClientInitializationMode,
	type TokenSetClientRegistryEntry,
} from "@securitydept/token-set-context-client/registry";
import {
	TokenSetBackendCallbackComponent,
	TokenSetClientRegistryService,
	TokenSetFrontendCallbackComponent,
} from "@securitydept/token-set-context-client-angular";
import { afterEach, describe, expect, it, vi } from "vitest";

function createSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return { tokens: { accessToken }, metadata: {} };
}

function createFrontendClient(): FrontendOidcModeClient {
	const snapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: {
			kind: OidcModeCallbackHandlingKind.Handled,
			result: {
				snapshot: createSnapshot("frontend-at"),
				postAuthRedirectUri: "/home",
			},
		},
	} as const);
	const resource = resourceFromSnapshots<
		OidcModeCallbackHandlingResult<FrontendOidcModeCallbackResult>
	>(() => snapshot.get());
	const dispose = vi.fn(() => resource.dispose());
	const client = {
		callback: { state: snapshot, resource, cancel: vi.fn() },
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	} as unknown as FrontendOidcModeClient;
	Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);
	return client;
}

function createBackendClient(): BackendOidcModeClient {
	const snapshot = createSignal({
		status: ResourceStatus.Resolved,
		value: {
			kind: OidcModeCallbackHandlingKind.Handled,
			result: createSnapshot("backend-at"),
		},
	} as const);
	const resource = resourceFromSnapshots<
		OidcModeCallbackHandlingResult<TokenSetAuthSnapshot>
	>(() => snapshot.get());
	const dispose = vi.fn(() => resource.dispose());
	const client = {
		callback: { state: snapshot, resource, cancel: vi.fn() },
		dispose,
		[SYMBOL_DISPOSE]: dispose,
	} as unknown as BackendOidcModeClient;
	Object.setPrototypeOf(client, BackendOidcModeClient.prototype);
	return client;
}

function createEntry(
	clientKey: string,
	clientFactory: () => BaseOidcModeClient,
	callbackPath?: string,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return {
		clientFactory,
		meta: {
			clientKey,
			urlPatterns: [],
			callbackPath,
			requirementKind: undefined,
			providerFamily: undefined,
			initialization: TokenSetClientInitializationMode.Lazy,
		},
	};
}

function createRouter(url: string): RouterTrait {
	return {
		currentUrl: () => UriReferenceString.parse(url),
		navigate: vi.fn(),
	};
}

function configure(options: {
	router: RouterTrait;
	entry: TokenSetClientRegistryEntry<BaseOidcModeClient>;
}): void {
	const registry = createTokenSetClientRegistry<BaseOidcModeClient>({
		environment: {},
	});
	registry.register(options.entry);
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ENVIRONMENT,
				useValue: { router: options.router } as FoundationEnvironment,
			},
			{ provide: TokenSetClientRegistryService, useValue: registry },
		],
	});
}

describe("token-set Angular callback components", () => {
	afterEach(() => {
		TestBed.resetTestingModule();
		vi.restoreAllMocks();
	});

	it("frontend component initializes the selected callback client", async () => {
		const clientFactory = vi.fn(() => createFrontendClient());
		configure({
			router: createRouter(
				"https://app.example.com/auth/callback?code=ok&state=s1",
			),
			entry: createEntry("frontend", clientFactory, "/auth/callback"),
		});

		const fixture = TestBed.createComponent(TokenSetFrontendCallbackComponent);
		fixture.detectChanges();
		await fixture.whenStable();

		await vi.waitFor(() => {
			expect(clientFactory).toHaveBeenCalledOnce();
			expect(fixture.componentInstance.state().status).toBe(
				ResourceStatus.Resolved,
			);
		});
	});

	it("frontend component resolves not-applicable outside its callback path", async () => {
		const clientFactory = vi.fn(() => createFrontendClient());
		configure({
			router: createRouter("https://app.example.com/dashboard"),
			entry: createEntry("frontend", clientFactory, "/auth/callback"),
		});

		const fixture = TestBed.createComponent(TokenSetFrontendCallbackComponent);
		fixture.detectChanges();
		await fixture.whenStable();

		expect(clientFactory).not.toHaveBeenCalled();
		expect(fixture.componentInstance.state()).toMatchObject({
			status: ResourceStatus.Resolved,
			value: { kind: OidcModeCallbackHandlingKind.NotApplicable },
		});
	});

	it("backend component selects by callback_routing_key", async () => {
		const clientFactory = vi.fn(() => createBackendClient());
		configure({
			router: createRouter(
				`https://app.example.com/callback#securitydept=v1&kind=${BackendOidcModeCompatFragmentKind.Callback}&callback_routing_key=backend&access_token=at`,
			),
			entry: createEntry("backend", clientFactory),
		});

		const fixture = TestBed.createComponent(TokenSetBackendCallbackComponent);
		fixture.detectChanges();
		await fixture.whenStable();

		await vi.waitFor(() => {
			expect(clientFactory).toHaveBeenCalledOnce();
			expect(fixture.componentInstance.state().status).toBe(
				ResourceStatus.Resolved,
			);
		});
	});
});
