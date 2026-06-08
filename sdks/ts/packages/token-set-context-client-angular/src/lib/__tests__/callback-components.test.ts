// @vitest-environment jsdom

import { TestBed } from "@angular/core/testing";
import {
	type FoundationEnvironment,
	OnceAsyncLockState,
	type RouterTrait,
	UriReferenceString,
} from "@securitydept/client";
import { ENVIRONMENT } from "@securitydept/client-angular";
import { BackendOidcModeClient } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	TokenSetBackendCallbackComponent,
	TokenSetClientRegistryService,
	TokenSetFrontendCallbackComponent,
} from "@securitydept/token-set-context-client-angular";
import { afterEach, describe, expect, it, vi } from "vitest";

function createSnapshot(accessToken: string) {
	return {
		tokens: {
			accessToken,
			idToken: `${accessToken}-id`,
		},
		metadata: {},
	};
}

function createRecord(clientKey: string) {
	return {
		get: () => ({
			meta: {
				clientKey,
			},
		}),
		watchStream: () => ({
			subscribe: () => ({ unsubscribe: () => undefined }),
		}),
	};
}

function createRegistry(clientKey: string, client: unknown, matched = true) {
	const record = createRecord(clientKey);
	return {
		clientRecordForQuery: vi.fn(
			(_query: unknown, options?: { initialize?: boolean }) => {
				if (!matched) {
					return options?.initialize ? Promise.resolve(undefined) : undefined;
				}
				return options?.initialize
					? Promise.resolve({ client, meta: { clientKey } })
					: record;
			},
		),
	};
}

function createEnvironment(router?: RouterTrait): FoundationEnvironment {
	return {
		router,
	} as FoundationEnvironment;
}

function createRouter(url: string | null) {
	const navigate = vi.fn(async () => undefined);
	return {
		router: {
			currentUrl: () => (url === null ? null : UriReferenceString.parse(url)),
			navigate,
		} satisfies RouterTrait,
		navigate,
	};
}

describe("token-set Angular callback components", () => {
	afterEach(() => {
		TestBed.resetTestingModule();
		vi.restoreAllMocks();
	});

	it("frontend component reads current URL from the environment router and exposes state as a signal", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: createSnapshot("frontend-at"),
			postAuthRedirectUri: "/home",
		}));
		const client = { handleCallback };
		Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);
		const registry = createRegistry("frontend", client);
		const { router } = createRouter(
			"https://app.example.com/auth/callback?code=ok&state=s1",
		);

		TestBed.configureTestingModule({
			imports: [TokenSetFrontendCallbackComponent],
			providers: [
				{ provide: ENVIRONMENT, useValue: createEnvironment(router) },
				{ provide: TokenSetClientRegistryService, useValue: registry },
			],
		});

		const fixture = TestBed.createComponent(TokenSetFrontendCallbackComponent);
		fixture.detectChanges();
		await fixture.whenStable();

		expect(typeof fixture.componentInstance.state).toBe("function");
		expect(handleCallback).toHaveBeenCalledWith(
			"https://app.example.com/auth/callback?code=ok&state=s1",
		);
		await vi.waitFor(() => {
			expect(fixture.componentInstance.state()).toMatchObject({
				state: OnceAsyncLockState.Success,
			});
		});
	});

	it("frontend component does not auto-handle when no callback client matches", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: createSnapshot("frontend-at"),
		}));
		const client = { handleCallback };
		Object.setPrototypeOf(client, FrontendOidcModeClient.prototype);
		const registry = createRegistry("frontend", client, false);
		const { router } = createRouter("https://app.example.com/not-callback");

		TestBed.configureTestingModule({
			imports: [TokenSetFrontendCallbackComponent],
			providers: [
				{ provide: ENVIRONMENT, useValue: createEnvironment(router) },
				{ provide: TokenSetClientRegistryService, useValue: registry },
			],
		});

		const fixture = TestBed.createComponent(TokenSetFrontendCallbackComponent);
		fixture.detectChanges();
		await fixture.whenStable();

		expect(handleCallback).not.toHaveBeenCalled();
		expect(fixture.componentInstance.state()).toMatchObject({
			state: OnceAsyncLockState.Init,
		});
	});

	it("backend component consumes compat fragment parameters from the environment router", async () => {
		const handleCallback = vi.fn(async () => createSnapshot("backend-at"));
		const client = { handleCallback };
		Object.setPrototypeOf(client, BackendOidcModeClient.prototype);
		const registry = createRegistry("backend", client);
		const { router, navigate } = createRouter(
			"https://app.example.com/callback#securitydept=v1&access_token=at&id_token=idt",
		);

		TestBed.configureTestingModule({
			imports: [TokenSetBackendCallbackComponent],
			providers: [
				{ provide: ENVIRONMENT, useValue: createEnvironment(router) },
				{ provide: TokenSetClientRegistryService, useValue: registry },
			],
		});

		const fixture = TestBed.createComponent(TokenSetBackendCallbackComponent);
		fixture.componentRef.setInput("clientQuery", { clientKey: "backend" });
		fixture.detectChanges();
		await fixture.whenStable();

		await vi.waitFor(() => {
			expect(handleCallback).toHaveBeenCalledWith({
				access_token: "at",
				id_token: "idt",
			});
			expect(fixture.componentInstance.state()).toMatchObject({
				state: OnceAsyncLockState.Success,
			});
		});
		expect(navigate).toHaveBeenCalledOnce();
	});

	it("backend component stays idle when no compat fragment exists", async () => {
		const handleCallback = vi.fn(async () => createSnapshot("backend-at"));
		const client = { handleCallback };
		Object.setPrototypeOf(client, BackendOidcModeClient.prototype);
		const registry = createRegistry("backend", client);
		const { router } = createRouter("https://app.example.com/callback#plain");

		TestBed.configureTestingModule({
			imports: [TokenSetBackendCallbackComponent],
			providers: [
				{ provide: ENVIRONMENT, useValue: createEnvironment(router) },
				{ provide: TokenSetClientRegistryService, useValue: registry },
			],
		});

		const fixture = TestBed.createComponent(TokenSetBackendCallbackComponent);
		fixture.componentRef.setInput("clientQuery", { clientKey: "backend" });
		fixture.detectChanges();
		await fixture.whenStable();

		expect(handleCallback).not.toHaveBeenCalled();
		expect(fixture.componentInstance.state()).toMatchObject({
			state: OnceAsyncLockState.Init,
		});
	});
});
