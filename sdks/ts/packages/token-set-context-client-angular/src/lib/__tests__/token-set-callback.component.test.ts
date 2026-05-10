import {
	createEnvironmentInjector,
	Injector,
	runInInjectionContext,
} from "@angular/core";
import { Router } from "@angular/router";
import { createSignal, createSubject } from "@securitydept/client";
import {
	type AuthSnapshot,
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import {
	CallbackResumeService,
	TOKEN_SET_CALLBACK_COMPONENT_OPTIONS,
	TOKEN_SET_CALLBACK_CURRENT_URL,
	TokenSetAuthRegistry,
	TokenSetCallbackComponent,
} from "@securitydept/token-set-context-client-angular";
import { afterEach, describe, expect, it, vi } from "vitest";

async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
}

describe("TokenSetCallbackComponent", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("uses the injected URL source and resumes callback navigation", async () => {
		const callbackService = {
			isCallback: vi.fn(() => true),
			resume: vi.fn(async () => ({
				clientKey: "frontend",
				snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
				postAuthRedirectUri: "/playground/token-set/frontend-mode",
			})),
		};
		const router = {
			navigateByUrl: vi.fn(async () => true),
		};
		const getCurrentUrl = vi.fn(
			() =>
				"https://example.test/auth/token-set/callback?code=auth-code&state=state-1",
		);
		const injector = createEnvironmentInjector(
			[
				{ provide: CallbackResumeService, useValue: callbackService },
				{ provide: Router, useValue: router },
				{ provide: TOKEN_SET_CALLBACK_CURRENT_URL, useValue: getCurrentUrl },
			],
			Injector.NULL as never,
		);

		const component = runInInjectionContext(
			injector,
			() => new TokenSetCallbackComponent(),
		);
		component.ngOnInit();
		await flushMicrotasks();

		expect(getCurrentUrl).toHaveBeenCalledTimes(1);
		expect(callbackService.isCallback).toHaveBeenCalledWith(
			"https://example.test/auth/token-set/callback?code=auth-code&state=state-1",
		);
		expect(callbackService.resume).toHaveBeenCalledWith(
			"https://example.test/auth/token-set/callback?code=auth-code&state=state-1",
		);
		expect(router.navigateByUrl).toHaveBeenCalledWith(
			"/playground/token-set/frontend-mode",
			{ replaceUrl: true },
		);
		injector.destroy();
	});

	it("navigates home when the injected URL source is not a callback", () => {
		const callbackService = {
			isCallback: vi.fn(() => false),
			resume: vi.fn(),
		};
		const router = {
			navigateByUrl: vi.fn(async () => true),
		};
		const injector = createEnvironmentInjector(
			[
				{ provide: CallbackResumeService, useValue: callbackService },
				{ provide: Router, useValue: router },
				{
					provide: TOKEN_SET_CALLBACK_CURRENT_URL,
					useValue: () => "https://example.test/not-a-callback",
				},
			],
			Injector.NULL as never,
		);

		const component = runInInjectionContext(
			injector,
			() => new TokenSetCallbackComponent(),
		);
		component.ngOnInit();

		expect(callbackService.resume).not.toHaveBeenCalled();
		expect(router.navigateByUrl).toHaveBeenCalledWith("/", {
			replaceUrl: true,
		});
		injector.destroy();
	});

	it("uses a custom fallbackUrl when the current URL is missing", () => {
		const callbackService = {
			isCallback: vi.fn(() => false),
			resume: vi.fn(),
		};
		const router = {
			navigateByUrl: vi.fn(async () => true),
		};
		const injector = createEnvironmentInjector(
			[
				{ provide: CallbackResumeService, useValue: callbackService },
				{ provide: Router, useValue: router },
				{
					provide: TOKEN_SET_CALLBACK_CURRENT_URL,
					useValue: () => undefined,
				},
				{
					provide: TOKEN_SET_CALLBACK_COMPONENT_OPTIONS,
					useValue: { fallbackUrl: "/custom-fallback" },
				},
			],
			Injector.NULL as never,
		);

		const component = runInInjectionContext(
			injector,
			() => new TokenSetCallbackComponent(),
		);
		component.ngOnInit();

		expect(callbackService.resume).not.toHaveBeenCalled();
		expect(router.navigateByUrl).toHaveBeenCalledWith("/custom-fallback", {
			replaceUrl: true,
		});
		injector.destroy();
	});

	it("uses custom errorRedirectUrl and onError without requiring console logging", async () => {
		const callbackError = new Error("callback failed");
		const callbackService = {
			isCallback: vi.fn(() => true),
			resume: vi.fn(async () => {
				throw callbackError;
			}),
		};
		const router = {
			navigateByUrl: vi.fn(async () => true),
		};
		const onError = vi.fn();
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});
		const injector = createEnvironmentInjector(
			[
				{ provide: CallbackResumeService, useValue: callbackService },
				{ provide: Router, useValue: router },
				{
					provide: TOKEN_SET_CALLBACK_CURRENT_URL,
					useValue: () =>
						"https://example.test/auth/token-set/callback?code=auth-code&state=state-1",
				},
				{
					provide: TOKEN_SET_CALLBACK_COMPONENT_OPTIONS,
					useValue: {
						errorRedirectUrl: "/error-target",
						onError,
					},
				},
			],
			Injector.NULL as never,
		);

		try {
			const component = runInInjectionContext(
				injector,
				() => new TokenSetCallbackComponent(),
			);
			component.ngOnInit();
			await flushMicrotasks();

			expect(onError).toHaveBeenCalledWith(callbackError);
			expect(consoleError).not.toHaveBeenCalled();
			expect(router.navigateByUrl).toHaveBeenCalledWith("/error-target", {
				replaceUrl: true,
			});
		} finally {
			consoleError.mockRestore();
			injector.destroy();
		}
	});

	it("CallbackResumeService exposes component-free resume state", async () => {
		const handleCallback = vi.fn(async () => ({
			snapshot: { tokens: { accessToken: "live-at" }, metadata: {} },
			postAuthRedirectUri: "/after-callback",
		}));
		const injector = createEnvironmentInjector(
			[TokenSetAuthRegistry, CallbackResumeService],
			Injector.NULL as never,
		);

		try {
			const registry = runInInjectionContext(injector, () =>
				injector.get(TokenSetAuthRegistry),
			);
			registry.register({
				key: "frontend",
				callbackPath: "/auth/token-set/callback",
				clientFactory: () => ({
					state: createSignal<AuthSnapshot | null>(null),
					authEvents: createSubject(),
					dispose: vi.fn(),
					restorePersistedState: vi.fn(async () => null),
					handleCallback,
					authorizationHeader: vi.fn(() => null),
					ensureAuthForResource: vi.fn(async () => ({
						status: EnsureAuthForResourceStatus.Unauthenticated,
						snapshot: null,
						authorizationHeader: null,
						reason: TokenSetAuthFlowReason.NoSnapshot,
					})),
					ensureFreshAuthState: vi.fn(async () => null),
					ensureAuthorizationHeader: vi.fn(async () => null),
					loginWithRedirect: vi.fn(async () => undefined),
				}),
			});
			const service = runInInjectionContext(injector, () =>
				injector.get(CallbackResumeService),
			);
			const observed: string[] = [];
			const subscription = service.state$.subscribe((state) => {
				observed.push(state.status);
			});

			await expect(
				service.resume(
					"https://app.example.com/auth/token-set/callback?code=abc&state=def",
				),
			).resolves.toMatchObject({
				clientKey: "frontend",
				postAuthRedirectUri: "/after-callback",
			});

			expect(handleCallback).toHaveBeenCalledTimes(1);
			expect(service.state()).toMatchObject({ status: "resolved" });
			expect(observed).toContain("resolved");
			subscription.unsubscribe();
		} finally {
			injector.destroy();
		}
	});
});
