import {
	type AuthRequirement,
	createFoundationEnvironment,
	REQUIREMENT_PLANNER_HOST,
	type RequirementBehaviourWithRouteContext,
	RequirementPlannerHost,
	RequirementsComposition,
	readSecuritydeptRouteMetadata,
	SecuritydeptInjector,
} from "@securitydept/client";
import {
	createTanStackBeforeLoad,
	createTanStackRouterContext,
	projectTanStackRouteSegments,
	secureRoute,
	secureRouteRoot,
	TanStackRouteSecurityBlockedError,
} from "@securitydept/client-react/tanstack-router";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	isRedirect,
} from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";

interface TestRequirement extends AuthRequirement {
	readonly kind: "session" | "admin";
}

const sessionRequirement: TestRequirement = {
	id: "session",
	kind: "session",
};

function createHost(
	behaviour: Partial<RequirementBehaviourWithRouteContext<TestRequirement>>,
) {
	return RequirementPlannerHost.fromBehaviour(behaviour, {
		environment: createFoundationEnvironment({}),
	});
}

function createInjector(host: RequirementPlannerHost<unknown>) {
	return SecuritydeptInjector.resolveAndCreate([
		{ provide: REQUIREMENT_PLANNER_HOST, useValue: host },
	]);
}

function beforeLoadContext(options: {
	readonly securitydeptInjector: ReturnType<typeof createInjector>;
	readonly matches: ReturnType<typeof secureMatch>[];
	readonly href?: string;
}) {
	return {
		context: {
			securitydeptInjector: options.securitydeptInjector,
			router: {
				state: {
					matches: options.matches,
				},
			},
		},
		matches: options.matches,
		location: {
			href: options.href ?? "/dashboard",
			pathname: options.href ?? "/dashboard",
		},
	};
}

describe("TanStack Router auth coordination", () => {
	it("secureRoute writes SecurityDept metadata into staticData only", () => {
		const route = secureRoute<TestRequirement>({
			requirements: [sessionRequirement],
			composition: RequirementsComposition.Replace,
		});

		expect(route.beforeLoad).toBeUndefined();
		expect(readSecuritydeptRouteMetadata(route.staticData)).toEqual({
			requirements: [sessionRequirement],
			composition: RequirementsComposition.Replace,
		});
	});

	it("projects TanStack router.state.matches staticData into route segments", async () => {
		const rootRoute = createRootRouteWithContext<{
			securitydeptInjector: ReturnType<typeof createInjector>;
		}>()({
			...secureRoute({ requirements: [sessionRequirement] }),
		});
		const childRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/dashboard",
			...secureRoute<TestRequirement>({
				requirements: [{ id: "admin", kind: "admin" }],
			}),
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([childRoute]),
			history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
			context: createTanStackRouterContext({
				injector: createInjector(
					createHost({
						checkAuthenticated: () => true,
						onUnauthenticated: () => false,
					}),
				),
			}),
		});

		await router.load();
		const segments = projectTanStackRouteSegments(router.state.matches);

		expect(segments.map((segment) => segment.requirements)).toEqual([
			[sessionRequirement],
			[{ id: "admin", kind: "admin" }],
		]);
	});

	it("beforeLoad reads RequirementPlannerHost from SecurityDept injector", async () => {
		const checkAuthenticated = vi.fn(() => true);
		const beforeLoad = createTanStackBeforeLoad<TestRequirement>();

		await beforeLoad(
			beforeLoadContext({
				securitydeptInjector: createInjector(
					createHost({
						checkAuthenticated,
						onUnauthenticated: () => false,
					}),
				),
				matches: [
					secureMatch({
						requirements: [sessionRequirement],
					}),
				],
			}),
		);

		expect(checkAuthenticated).toHaveBeenCalledWith(
			sessionRequirement,
			expect.objectContaining({
				planContext: { routeState: { url: "/dashboard" } },
			}),
		);
	});

	it("secureRouteRoot composes existing beforeLoad before security", async () => {
		const previousBeforeLoad = vi.fn(() => ({ user: "existing" }));
		const route = secureRouteRoot<TestRequirement>(
			{ requirements: [sessionRequirement] },
			{ beforeLoad: previousBeforeLoad },
		);

		const result = await route.beforeLoad?.(
			beforeLoadContext({
				securitydeptInjector: createInjector(
					createHost({
						checkAuthenticated: () => true,
						onUnauthenticated: () => false,
					}),
				),
				matches: [secureMatch({ requirements: [sessionRequirement] })],
			}),
		);

		expect(previousBeforeLoad).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ user: "existing" });
	});

	it("route-scoped behaviour overrides parent host through child injector", async () => {
		const parentHost = createHost({
			checkAuthenticated: () => false,
			onUnauthenticated: () => "/login-from-parent",
		});
		const route = secureRouteRoot<TestRequirement>({
			requirements: [sessionRequirement],
			behaviour: {
				checkAuthenticated: () => true,
				onUnauthenticated: () => false,
			},
		});

		await expect(
			route.beforeLoad?.(
				beforeLoadContext({
					securitydeptInjector: createInjector(parentHost),
					matches: [secureMatch({ requirements: [sessionRequirement] })],
				}),
			),
		).resolves.toBeUndefined();
	});

	it("maps blocked and redirect outcomes to TanStack beforeLoad semantics", async () => {
		const blocked = createTanStackBeforeLoad<TestRequirement>({
			plannerHost: createHost({
				checkAuthenticated: () => false,
				onUnauthenticated: () => false,
			}),
		});
		const redirected = createTanStackBeforeLoad<TestRequirement>({
			plannerHost: createHost({
				checkAuthenticated: () => false,
				onUnauthenticated: () => "/login",
			}),
		});
		const context = beforeLoadContext({
			securitydeptInjector: createInjector(
				createHost({
					checkAuthenticated: () => false,
					onUnauthenticated: () => false,
				}),
			),
			matches: [secureMatch({ requirements: [sessionRequirement] })],
		});

		await expect(blocked(context)).rejects.toBeInstanceOf(
			TanStackRouteSecurityBlockedError,
		);
		await expect(
			redirected(
				beforeLoadContext({
					securitydeptInjector: createInjector(
						createHost({
							checkAuthenticated: () => false,
							onUnauthenticated: () => "/login",
						}),
					),
					matches: [secureMatch({ requirements: [sessionRequirement] })],
				}),
			),
		).rejects.toSatisfy(isRedirect);
	});

	it("core RequirementPlannerHost token is injectable", () => {
		const host = createHost({
			checkAuthenticated: () => true,
			onUnauthenticated: () => false,
		});
		const injector = createInjector(host);

		expect(injector.get(REQUIREMENT_PLANNER_HOST)).toBe(host);
	});
});

function secureMatch<TAuthRequirement extends AuthRequirement>(security: {
	readonly requirements?: readonly TAuthRequirement[];
	readonly composition?: RequirementsComposition;
}) {
	return {
		routeId: "route",
		staticData: secureRoute(security).staticData,
	};
}
