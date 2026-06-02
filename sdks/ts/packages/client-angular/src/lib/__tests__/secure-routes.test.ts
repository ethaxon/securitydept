import { HttpClient, HttpResponse } from "@angular/common/http";
import {
	createEnvironmentInjector,
	type EnvironmentProviders,
	type Provider,
	runInInjectionContext,
} from "@angular/core";
import {
	type CanActivateChildFn,
	type CanActivateFn,
	Router,
} from "@angular/router";
import {
	RequirementPlannerHost,
	StaticAttrsAuthRequirement,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { secureRouteRoot } from "../auth-coordination/secure-routes";
import { provideEnvironment } from "../environment";

describe("secureRouteRoot", () => {
	it("appends security guards without dropping route option guards", () => {
		const canActivate: CanActivateFn = () => true;
		const canActivateChild: CanActivateChildFn = () => true;

		const route = secureRouteRoot(
			"app",
			{
				requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
			},
			{
				canActivate: [canActivate],
				canActivateChild: [canActivateChild],
			},
		);

		expect(route.canActivate).toHaveLength(2);
		expect(route.canActivate?.[0]).toBe(canActivate);
		expect(route.canActivateChild).toHaveLength(2);
		expect(route.canActivateChild?.[0]).toBe(canActivateChild);
	});

	it("reuses the provided planner host instead of wrapping it per guard", async () => {
		const fromBehaviour = vi.spyOn(RequirementPlannerHost, "fromBehaviour");
		const route = secureRouteRoot("app", {
			requirements: [StaticAttrsAuthRequirement.create({ id: "session" })],
			behaviour: {
				checkAuthenticated: () => true,
				onUnauthenticated: () => false,
			},
		});
		const appInjector = createEnvironmentInjector(
			[
				{
					provide: HttpClient,
					useValue: {
						request: vi.fn(() => of(new HttpResponse({ status: 200 }))),
					},
				},
				provideEnvironment({
					createBaseEnvironment: createEnvironmentForTest,
				}),
				{
					provide: Router,
					useValue: {
						url: "/app",
						navigateByUrl: vi.fn(async () => true),
						parseUrl: vi.fn(),
					},
				},
			],
			null as never,
		);
		const routeInjector = createEnvironmentInjector(
			[
				...(route.providers as readonly (Provider | EnvironmentProviders)[]),
				{
					provide: Router,
					useValue: {
						url: "/app",
						navigateByUrl: vi.fn(async () => true),
						parseUrl: vi.fn(),
					},
				},
			],
			appInjector,
		);
		const routeSnapshot = {
			pathFromRoot: [
				{
					data: {},
					routeConfig: {
						path: "app",
						data: route.data,
					},
				},
			],
		};
		const stateSnapshot = { url: "/app" };

		try {
			const activate = route.canActivate?.[0] as CanActivateFn | undefined;
			const activateChild = route.canActivateChild?.[0] as
				| CanActivateChildFn
				| undefined;
			await runInInjectionContext(routeInjector, () =>
				activate?.(routeSnapshot as never, stateSnapshot as never),
			);
			await runInInjectionContext(routeInjector, () =>
				activateChild?.(routeSnapshot as never, stateSnapshot as never),
			);

			expect(fromBehaviour).toHaveBeenCalledTimes(1);
		} finally {
			fromBehaviour.mockRestore();
			routeInjector.destroy();
			appInjector.destroy();
		}
	});
});
