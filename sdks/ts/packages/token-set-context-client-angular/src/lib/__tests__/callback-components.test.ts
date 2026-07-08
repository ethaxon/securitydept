// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import {
	createFoundationEnvironment,
	ResourceStatus,
	type RouterTrait,
	UriReferenceString,
} from "@securitydept/client";
import { ENVIRONMENT } from "@securitydept/client-angular";
import { BackendOidcModeCompatFragmentKind } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { type FrontendOidcModeCallbackResult } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type BaseOidcModeClient,
	OidcModeCallbackHandlingKind,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import {
	type TokenSetBackendCallbackClient,
	type TokenSetCallbackClientGuard,
	TokenSetCallbackClientSelectionKind,
	TokenSetClientRegistry,
	type TokenSetClientRegistryEntry,
	type TokenSetFrontendCallbackClient,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
	TokenSetClientForTest,
} from "@securitydept/token-set-context-client/test";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	TokenSetBackendCallbackComponent,
	TokenSetFrontendCallbackComponent,
} from "@securitydept/token-set-context-client-angular";
import { afterEach, describe, expect, it, vi } from "vitest";

function createSnapshot(accessToken: string): TokenSetAuthSnapshot {
	return { tokens: { accessToken }, metadata: {} };
}

function createFrontendClient(): TokenSetClientForTest<FrontendOidcModeCallbackResult> {
	return createTokenSetClientForTest({
		callbackSnapshot: {
			status: ResourceStatus.Resolved,
			value: {
				kind: OidcModeCallbackHandlingKind.Handled,
				result: {
					snapshot: createSnapshot("frontend-at"),
					postAuthRedirectUri: "/home",
				},
			},
		},
	});
}

function createBackendClient(): TokenSetClientForTest<TokenSetAuthSnapshot> {
	return createTokenSetClientForTest({
		callbackSnapshot: {
			status: ResourceStatus.Resolved,
			value: {
				kind: OidcModeCallbackHandlingKind.Handled,
				result: createSnapshot("backend-at"),
			},
		},
	});
}

const frontendClientGuard: TokenSetCallbackClientGuard<
	TokenSetFrontendCallbackClient
> = (client): client is TokenSetFrontendCallbackClient =>
	client instanceof TokenSetClientForTest;

const backendClientGuard: TokenSetCallbackClientGuard<
	TokenSetBackendCallbackClient
> = (client): client is TokenSetBackendCallbackClient =>
	client instanceof TokenSetClientForTest;

function createEntry(
	clientKey: string,
	clientFactory: () => BaseOidcModeClient,
	callbackUrl?: string,
): TokenSetClientRegistryEntry<BaseOidcModeClient> {
	return createTokenSetClientRegistryEntryForTest({
		clientKey,
		clientFactory,
		callbackUrl,
	});
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
	const environment = createFoundationEnvironment({ router: options.router });
	const registry =
		TokenSetClientRegistry.fromEnvironmentConfig<BaseOidcModeClient>({
			environment,
		});
	registry.register(options.entry);
	TestBed.configureTestingModule({
		providers: [
			{
				provide: ENVIRONMENT,
				useValue: environment,
			},
			{ provide: TOKEN_SET_CLIENT_REGISTRY, useValue: registry },
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
		const router = createRouter(
			"https://app.example.com/auth/callback?code=ok&state=s1",
		);
		const currentUrl = vi.spyOn(router, "currentUrl");
		configure({
			router,
			entry: createEntry("frontend", clientFactory, "/auth/callback"),
		});

		const fixture = TestBed.createComponent(TokenSetFrontendCallbackComponent);
		fixture.componentRef.setInput("clientGuard", frontendClientGuard);
		expect(fixture.componentInstance.selection().status).toBe(
			ResourceStatus.Idle,
		);
		expect(fixture.componentInstance.state().status).toBe(ResourceStatus.Idle);
		expect(currentUrl).not.toHaveBeenCalled();
		fixture.detectChanges();
		await fixture.whenStable();

		await vi.waitFor(() => {
			expect(clientFactory).toHaveBeenCalledOnce();
			expect(fixture.componentInstance.state().status).toBe(
				ResourceStatus.Resolved,
			);
		});
		expect(fixture.componentInstance.selection()).toMatchObject({
			status: ResourceStatus.Resolved,
			value: { kind: TokenSetCallbackClientSelectionKind.Selected },
		});
		expect(currentUrl).toHaveBeenCalledOnce();
	});

	it("frontend component resolves not-applicable outside its callback path", async () => {
		const clientFactory = vi.fn(() => createFrontendClient());
		configure({
			router: createRouter("https://app.example.com/dashboard"),
			entry: createEntry("frontend", clientFactory, "/auth/callback"),
		});

		const fixture = TestBed.createComponent(TokenSetFrontendCallbackComponent);
		fixture.componentRef.setInput("clientGuard", frontendClientGuard);
		fixture.detectChanges();
		await fixture.whenStable();

		expect(clientFactory).not.toHaveBeenCalled();
		expect(fixture.componentInstance.state()).toMatchObject({
			status: ResourceStatus.Resolved,
			value: { kind: OidcModeCallbackHandlingKind.NotApplicable },
		});
	});

	it("forwards a custom frontend callback client query", async () => {
		const clientFactory = vi.fn(() => createFrontendClient());
		configure({
			router: createRouter("https://app.example.com/custom-callback?code=ok"),
			entry: createEntry("frontend", clientFactory, "/different-callback"),
		});
		const clientQuery = vi.fn(({ callbackUrl }) => {
			expect(callbackUrl.pathname).toBe("/custom-callback");
			return { clientKey: "frontend" };
		});

		const fixture = TestBed.createComponent(TokenSetFrontendCallbackComponent);
		fixture.componentRef.setInput("clientQuery", clientQuery);
		fixture.componentRef.setInput("clientGuard", frontendClientGuard);
		fixture.detectChanges();
		await fixture.whenStable();

		await vi.waitFor(() => {
			expect(clientQuery).toHaveBeenCalled();
			expect(clientFactory).toHaveBeenCalledOnce();
			expect(fixture.componentInstance.state().status).toBe(
				ResourceStatus.Resolved,
			);
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
		fixture.componentRef.setInput("clientGuard", backendClientGuard);
		fixture.detectChanges();
		await fixture.whenStable();

		await vi.waitFor(() => {
			expect(clientFactory).toHaveBeenCalledOnce();
			expect(fixture.componentInstance.state().status).toBe(
				ResourceStatus.Resolved,
			);
		});
		expect(fixture.componentInstance.selection()).toMatchObject({
			status: ResourceStatus.Resolved,
			value: { kind: TokenSetCallbackClientSelectionKind.Selected },
		});
	});
});
