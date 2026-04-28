import {
	createEnvironmentInjector,
	type EnvironmentInjector,
	InjectionToken,
	inject,
	runInInjectionContext,
} from "@angular/core";
import type {
	ActivatedRouteSnapshot,
	RouterStateSnapshot,
} from "@angular/router";
import { Router } from "@angular/router";
import type {
	PlannerHost,
	PlannerHostResult,
} from "@securitydept/client/auth-coordination";
import { AUTH_PLANNER_HOST } from "@securitydept/client-angular";
import {
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowReason,
} from "@securitydept/token-set-context-client/orchestration";
import {
	createFrontendOidcLoginRedirectHandler,
	createTokenSetRouteAggregationGuard,
	TokenSetAuthRegistry,
} from "@securitydept/token-set-context-client-angular";
import { describe, expect, it, vi } from "vitest";

const TEST_AUTH_ACTION = new InjectionToken<() => void>("TEST_AUTH_ACTION");
const NULL_ENVIRONMENT_INJECTOR = null as unknown as EnvironmentInjector;

describe("Angular token-set route guard injection context", () => {
	it("runs unauthenticated handlers in the captured injector after async planner work", async () => {
		let actionCalls = 0;
		let attemptedUrl: string | undefined;
		const service = {
			isAuthenticated: () => false,
			restorePromise: null,
			ensureAuthForResource: vi.fn().mockResolvedValue({
				status: EnsureAuthForResourceStatus.Unauthenticated,
				snapshot: null,
				authorizationHeader: null,
				reason: TokenSetAuthFlowReason.NoSnapshot,
			}),
		};
		const registry = {
			clientKeyListForRequirement: () => ["confluence"],
			whenReady: async () => service,
			metaFor: () => ({
				key: "confluence",
				requirementKind: "frontend_oidc",
			}),
		};
		const plannerHost: PlannerHost = {
			async evaluate(candidates): Promise<PlannerHostResult> {
				await Promise.resolve();
				return {
					allAuthenticated: false,
					unauthenticatedCandidates: candidates,
					pendingCandidate: candidates[0],
				};
			},
		};
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				{
					provide: Router,
					useValue: { parseUrl: (value: string) => ({ redirectedTo: value }) },
				},
				{ provide: AUTH_PLANNER_HOST, useValue: plannerHost },
				{
					provide: TEST_AUTH_ACTION,
					useValue: () => {
						actionCalls += 1;
					},
				},
			],
			NULL_ENVIRONMENT_INJECTOR,
		);
		const route = createRouteSnapshot();
		const guard = createTokenSetRouteAggregationGuard({
			requirementHandlers: {
				frontend_oidc: (_failing, _requirement, context) => {
					inject(TEST_AUTH_ACTION)();
					attemptedUrl = context.attemptedUrl;
					return false;
				},
			},
		});

		const result = await runInInjectionContext(injector, () =>
			guard(route, { url: "/confluence" } as RouterStateSnapshot),
		);

		expect(result).toBe(false);
		expect(actionCalls).toBe(1);
		expect(attemptedUrl).toBe("/confluence");

		injector.destroy();
	});

	it("uses the attempted router state URL for frontend OIDC login redirects", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const service = {
			client: { loginWithRedirect },
			isAuthenticated: () => false,
			restorePromise: null,
			ensureAuthForResource: vi.fn().mockResolvedValue({
				status: EnsureAuthForResourceStatus.Unauthenticated,
				snapshot: null,
				authorizationHeader: null,
				reason: TokenSetAuthFlowReason.NoSnapshot,
			}),
		};
		const registry = {
			clientKeyListForRequirement: () => ["confluence"],
			whenReady: async () => service,
			metaFor: () => ({
				key: "confluence",
				requirementKind: "frontend_oidc",
			}),
		};
		const plannerHost: PlannerHost = {
			async evaluate(candidates): Promise<PlannerHostResult> {
				await Promise.resolve();
				return {
					allAuthenticated: false,
					unauthenticatedCandidates: candidates,
					pendingCandidate: candidates[0],
				};
			},
		};
		const injector = createEnvironmentInjector(
			[
				{ provide: TokenSetAuthRegistry, useValue: registry },
				{
					provide: Router,
					useValue: { parseUrl: (value: string) => ({ redirectedTo: value }) },
				},
				{ provide: AUTH_PLANNER_HOST, useValue: plannerHost },
			],
			NULL_ENVIRONMENT_INJECTOR,
		);
		const guard = createTokenSetRouteAggregationGuard({
			requirementHandlers: {
				frontend_oidc: createFrontendOidcLoginRedirectHandler({
					clientKey: "confluence",
				}),
			},
		});

		const guardResult = runInInjectionContext(injector, () =>
			guard(createRouteSnapshot(), {
				url: "/confluence/spaces/abc?tab=pages",
			} as RouterStateSnapshot),
		);
		const settled = vi.fn();
		Promise.resolve(guardResult).then(settled, settled);

		await flushMicrotasks();
		expect(loginWithRedirect).toHaveBeenCalledWith({
			postAuthRedirectUri: "/confluence/spaces/abc?tab=pages",
		});
		expect(settled).not.toHaveBeenCalled();

		injector.destroy();
	});
});

function createRouteSnapshot(): ActivatedRouteSnapshot {
	const route = {
		data: {
			authRequirements: [
				{
					id: "confluence-oidc",
					kind: "frontend_oidc",
					label: "Confluence OIDC",
				},
			],
		},
		routeConfig: { data: {} },
	} as unknown as ActivatedRouteSnapshot & {
		pathFromRoot: ActivatedRouteSnapshot[];
	};
	route.pathFromRoot = [route];
	return route;
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}
