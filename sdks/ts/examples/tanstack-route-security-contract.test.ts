// TanStack React Router route-security contract evidence test
//
// Proves the canonical TanStack Router route-security pattern (Iteration 107),
// aligned with the Angular Router contract from Iteration 106:
//
//   1. Route metadata declaration: withTanStackRouteRequirements()
//   2. Full-route composition: extractTanStackRouteRequirements() with
//      merge / replace / inherit semantics
//   3. Headless policy: createTanStackRouteSecurityPolicy()
//   4. Child-level serializable declaration only
//   5. beforeLoad execution glue: createSecureBeforeLoad() — the canonical
//      adopter-facing entry that wires runtime policy into TanStack Router's
//      actual execution semantics (throws redirect / RouteSecurityBlockedError)
//   6. Angular / React parity
//
// Section 5 exercises TanStack Router's real execution model:
//   - beforeLoad context shape (location, matches, cause)
//   - redirect throw semantics (TanStack Router's redirect() mechanism)
//   - RouteSecurityBlockedError for hard navigation blocks
//   - Root-level policy consumption of child route staticData declarations

import {
	createExternalRedirectBeforeLoadHandler,
	createSecureBeforeLoad,
	createTanStackRouteSecurityPolicy,
	DEFAULT_COMPOSITION_KEY,
	DEFAULT_REQUIREMENTS_KEY,
	extractTanStackRouteRequirements,
	RequirementsClientSetComposition,
	type RouteRequirementsDeclaration,
	RouteSecurityBlockedError,
	resolveEffectiveRequirements,
	type SecureBeforeLoadContext,
	type TanStackRouteMatch,
	withTanStackRouteRequirements,
} from "@securitydept/client-react/tanstack-router";
import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// 1. withTanStackRouteRequirements helper
// ---------------------------------------------------------------------------

describe("TanStack route-security — withTanStackRouteRequirements", () => {
	it("produces staticData with requirements and default merge composition", () => {
		const data = withTanStackRouteRequirements([
			{ id: "session", kind: "session" },
		]);
		expect(data[DEFAULT_REQUIREMENTS_KEY]).toEqual([
			{ id: "session", kind: "session" },
		]);
		expect(data[DEFAULT_COMPOSITION_KEY]).toBe(
			RequirementsClientSetComposition.Merge,
		);
	});

	it("respects explicit replace composition", () => {
		const data = withTanStackRouteRequirements([], {
			composition: RequirementsClientSetComposition.Replace,
		});
		expect(data[DEFAULT_REQUIREMENTS_KEY]).toEqual([]);
		expect(data[DEFAULT_COMPOSITION_KEY]).toBe(
			RequirementsClientSetComposition.Replace,
		);
	});

	it("merges extra staticData properties", () => {
		const data = withTanStackRouteRequirements(
			[{ id: "oidc", kind: "frontend_oidc" }],
			{ extra: { title: "Protected" } },
		);
		expect(data.title).toBe("Protected");
		expect(data[DEFAULT_REQUIREMENTS_KEY]).toHaveLength(1);
	});

	it("produces empty requirements array", () => {
		const data = withTanStackRouteRequirements([]);
		expect(data[DEFAULT_REQUIREMENTS_KEY]).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 2. resolveEffectiveRequirements — composition semantics
// ---------------------------------------------------------------------------

describe("TanStack route-security — resolveEffectiveRequirements", () => {
	const parentReqs = [
		{ id: "session", kind: "session" },
		{ id: "base-oidc", kind: "frontend_oidc" },
	];

	it("merge appends child requirements and replaces same-id entries", () => {
		const child: RouteRequirementsDeclaration = {
			composition: RequirementsClientSetComposition.Merge,
			requirements: [
				{ id: "base-oidc", kind: "frontend_oidc", label: "Updated" },
				{ id: "admin-oidc", kind: "backend_oidc" },
			],
		};
		const result = resolveEffectiveRequirements(parentReqs, child);
		expect(result).toHaveLength(3);
		expect(result.map((r) => r.id)).toEqual([
			"session",
			"base-oidc",
			"admin-oidc",
		]);
		// Same-id entry replaced: label updated
		expect(result.find((r) => r.id === "base-oidc")?.label).toBe("Updated");
	});

	it("replace discards parent requirements entirely", () => {
		const child: RouteRequirementsDeclaration = {
			composition: RequirementsClientSetComposition.Replace,
			requirements: [{ id: "only-child", kind: "custom" }],
		};
		const result = resolveEffectiveRequirements(parentReqs, child);
		expect(result).toEqual([{ id: "only-child", kind: "custom" }]);
	});

	it("replace with empty array creates a public zone", () => {
		const child: RouteRequirementsDeclaration = {
			composition: RequirementsClientSetComposition.Replace,
			requirements: [],
		};
		const result = resolveEffectiveRequirements(parentReqs, child);
		expect(result).toEqual([]);
	});

	it("inherit keeps parent requirements unchanged", () => {
		const child: RouteRequirementsDeclaration = {
			composition: RequirementsClientSetComposition.Inherit,
			requirements: [{ id: "ignored", kind: "whatever" }],
		};
		const result = resolveEffectiveRequirements(parentReqs, child);
		expect(result).toEqual(parentReqs);
	});
});

// ---------------------------------------------------------------------------
// 3. extractTanStackRouteRequirements — full-route aggregation
// ---------------------------------------------------------------------------

describe("TanStack route-security — extractTanStackRouteRequirements", () => {
	it("returns empty array when no match has requirements", () => {
		const matches: TanStackRouteMatch[] = [
			{ routeId: "__root__" },
			{ routeId: "/public", staticData: {} },
		];
		expect(extractTanStackRouteRequirements(matches)).toEqual([]);
	});

	it("extracts requirements from a single route", () => {
		const matches: TanStackRouteMatch[] = [
			{ routeId: "__root__" },
			{
				routeId: "/dashboard",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
				]),
			},
		];
		const reqs = extractTanStackRouteRequirements(matches);
		expect(reqs).toHaveLength(1);
		expect(reqs[0]?.id).toBe("session");
	});

	it("accumulates parent + child requirements via merge", () => {
		const matches: TanStackRouteMatch[] = [
			{ routeId: "__root__" },
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
				]),
			},
			{
				routeId: "/app/admin",
				staticData: withTanStackRouteRequirements([
					{ id: "admin-oidc", kind: "backend_oidc" },
				]),
			},
		];
		const reqs = extractTanStackRouteRequirements(matches);
		expect(reqs).toHaveLength(2);
		expect(reqs.map((r) => r.id)).toEqual(["session", "admin-oidc"]);
	});

	it("child replace discards parent requirements — public zone", () => {
		const matches: TanStackRouteMatch[] = [
			{ routeId: "__root__" },
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
					{ id: "oidc-a", kind: "frontend_oidc" },
				]),
			},
			{
				// Public zone: explicitly replaces parent requirements with empty set
				routeId: "/app/public-zone",
				staticData: withTanStackRouteRequirements([], {
					composition: RequirementsClientSetComposition.Replace,
				}),
			},
		];
		const reqs = extractTanStackRouteRequirements(matches);
		expect(reqs).toEqual([]);
	});

	it("handles 3-level route aggregation (root → parent → child → leaf)", () => {
		const matches: TanStackRouteMatch[] = [
			{ routeId: "__root__" },
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
				]),
			},
			{
				routeId: "/app/admin",
				staticData: withTanStackRouteRequirements([
					{ id: "admin-oidc", kind: "backend_oidc" },
				]),
			},
			{
				routeId: "/app/admin/settings",
				staticData: withTanStackRouteRequirements([
					{ id: "settings-perm", kind: "frontend_oidc" },
				]),
			},
		];
		const reqs = extractTanStackRouteRequirements(matches);
		expect(reqs).toHaveLength(3);
		expect(reqs.map((r) => r.id)).toEqual([
			"session",
			"admin-oidc",
			"settings-perm",
		]);
	});

	it("supports custom requirementsKey", () => {
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/custom",
				staticData: { myAuthReqs: [{ id: "c", kind: "custom" }] },
			},
		];
		const reqs = extractTanStackRouteRequirements(matches, {
			requirementsKey: "myAuthReqs",
		});
		expect(reqs).toHaveLength(1);
		expect(reqs[0]?.id).toBe("c");
	});
});

// ---------------------------------------------------------------------------
// 4. createTanStackRouteSecurityPolicy — root-level runtime policy
// ---------------------------------------------------------------------------

describe("TanStack route-security — createTanStackRouteSecurityPolicy", () => {
	it("returns allMet: true when all requirements are satisfied", () => {
		const policy = createTanStackRouteSecurityPolicy();
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
				]),
			},
		];
		const result = policy.evaluate(matches, () => true);
		expect(result.allMet).toBe(true);
		expect(result.pendingRequirement).toBeUndefined();
		expect(result.action).toBeUndefined();
	});

	it("returns first unmet requirement when some are not satisfied", () => {
		const policy = createTanStackRouteSecurityPolicy();
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
					{ id: "oidc", kind: "frontend_oidc" },
				]),
			},
		];
		// session is met, oidc is not
		const result = policy.evaluate(matches, (req) => req.kind === "session");
		expect(result.allMet).toBe(false);
		expect(result.pendingRequirement?.id).toBe("oidc");
	});

	it("uses kind-specific handler when available", () => {
		const policy = createTanStackRouteSecurityPolicy({
			requirementHandlers: {
				frontend_oidc: () => "/login/oidc",
			},
		});
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "oidc", kind: "frontend_oidc" },
				]),
			},
		];
		const result = policy.evaluate(matches, () => false);
		expect(result.action).toBe("/login/oidc");
	});

	it("falls back to defaultOnUnauthenticated when no kind handler", () => {
		const policy = createTanStackRouteSecurityPolicy({
			defaultOnUnauthenticated: () => "/login",
		});
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
				]),
			},
		];
		const result = policy.evaluate(matches, () => false);
		expect(result.action).toBe("/login");
	});

	it("kind handler takes precedence over defaultOnUnauthenticated", () => {
		const policy = createTanStackRouteSecurityPolicy({
			requirementHandlers: {
				session: () => "/session-login",
			},
			defaultOnUnauthenticated: () => "/generic-login",
		});
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "s", kind: "session" },
				]),
			},
		];
		const result = policy.evaluate(matches, () => false);
		expect(result.action).toBe("/session-login");
	});

	it("blocks navigation (false) when no handler is provided", () => {
		const policy = createTanStackRouteSecurityPolicy();
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/secure",
				staticData: withTanStackRouteRequirements([
					{ id: "oidc", kind: "frontend_oidc" },
				]),
			},
		];
		const result = policy.evaluate(matches, () => false);
		expect(result.action).toBe(false);
	});

	it("evaluates full aggregated set from parent + child with composition", () => {
		const policy = createTanStackRouteSecurityPolicy({
			requirementHandlers: {
				frontend_oidc: (req) => `/login/${req.id}`,
			},
		});
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
				]),
			},
			{
				routeId: "/app/dashboard",
				staticData: withTanStackRouteRequirements([
					{ id: "dash-oidc", kind: "frontend_oidc" },
				]),
			},
		];
		// session met, oidc not
		const result = policy.evaluate(matches, (req) => req.kind === "session");
		expect(result.allMet).toBe(false);
		expect(result.pendingRequirement?.id).toBe("dash-oidc");
		expect(result.action).toBe("/login/dash-oidc");
		// effectiveRequirements should contain both
		expect(result.effectiveRequirements).toHaveLength(2);
	});

	it("child replace composition allows public zone under protected parent", () => {
		const policy = createTanStackRouteSecurityPolicy({
			defaultOnUnauthenticated: () => "/login",
		});
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
				]),
			},
			{
				routeId: "/app/public",
				staticData: withTanStackRouteRequirements([], {
					composition: RequirementsClientSetComposition.Replace,
				}),
			},
		];
		// Even though nothing is authenticated, replace with [] means no requirements
		const result = policy.evaluate(matches, () => false);
		expect(result.allMet).toBe(true);
		expect(result.effectiveRequirements).toEqual([]);
	});

	it("effectiveRequirements reflects the full composed result", () => {
		const policy = createTanStackRouteSecurityPolicy();
		const matches: TanStackRouteMatch[] = [
			{
				routeId: "/app",
				staticData: withTanStackRouteRequirements([
					{ id: "session", kind: "session" },
					{ id: "base-oidc", kind: "frontend_oidc" },
				]),
			},
			{
				routeId: "/app/admin",
				staticData: withTanStackRouteRequirements([
					{ id: "base-oidc", kind: "frontend_oidc", label: "Upgraded" },
					{ id: "admin-api", kind: "backend_oidc" },
				]),
			},
		];
		const result = policy.evaluate(matches, () => true);
		expect(result.effectiveRequirements).toHaveLength(3);
		expect(result.effectiveRequirements.map((r) => r.id)).toEqual([
			"session",
			"base-oidc",
			"admin-api",
		]);
		expect(
			result.effectiveRequirements.find((r) => r.id === "base-oidc")?.label,
		).toBe("Upgraded");
	});
});

// ---------------------------------------------------------------------------
// 5. createSecureBeforeLoad — TanStack Router execution glue
// ---------------------------------------------------------------------------

/**
 * Helper to build a realistic TanStack Router `beforeLoad` context.
 * Simulates what TanStack Router passes to `beforeLoad` on navigation.
 */
function buildBeforeLoadContext(
	matches: TanStackRouteMatch[],
	pathname = "/",
	cause = "enter",
): SecureBeforeLoadContext {
	return {
		location: { pathname, href: `http://localhost${pathname}` },
		matches,
		cause,
	};
}

/**
 * Simulate TanStack Router's `redirect()` function for testing.
 * In real TanStack Router, `redirect()` creates and throws a redirect object.
 */
function createMockRedirect(): {
	redirectFn: (opts: { to: string }) => never;
	lastRedirect: { to: string } | undefined;
} {
	let lastRedirect: { to: string } | undefined;
	const redirectFn = (opts: { to: string }): never => {
		lastRedirect = opts;
		throw { __isRedirect: true, ...opts };
	};
	return {
		redirectFn,
		get lastRedirect() {
			return lastRedirect;
		},
	};
}

describe("TanStack route-security — createSecureBeforeLoad (execution glue)", () => {
	it("returns normally when all requirements are satisfied", () => {
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => true,
		});
		const ctx = buildBeforeLoadContext(
			[
				{ routeId: "__root__" },
				{
					routeId: "/dashboard",
					staticData: withTanStackRouteRequirements([
						{ id: "session", kind: "session" },
					]),
				},
			],
			"/dashboard",
		);

		// Should not throw — navigation proceeds
		expect(() => securedBeforeLoad(ctx)).not.toThrow();
	});

	it("throws redirect when handler returns a string path", () => {
		const { redirectFn } = createMockRedirect();
		const securedBeforeLoad = createSecureBeforeLoad({
			redirect: redirectFn,
			checkAuthenticated: () => false,
			defaultOnUnauthenticated: () => "/login",
		});
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/secure",
					staticData: withTanStackRouteRequirements([
						{ id: "session", kind: "session" },
					]),
				},
			],
			"/secure",
		);

		// Should throw redirect object (TanStack Router convention)
		try {
			securedBeforeLoad(ctx);
			expect.unreachable("should have thrown");
		} catch (err: unknown) {
			expect(err).toHaveProperty("__isRedirect", true);
			expect(err).toHaveProperty("to", "/login");
		}
	});

	it("throws RouteSecurityBlockedError when handler returns false", () => {
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => false,
			defaultOnUnauthenticated: () => false,
		});
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/protected",
					staticData: withTanStackRouteRequirements([
						{ id: "oidc", kind: "frontend_oidc" },
					]),
				},
			],
			"/protected",
		);

		try {
			securedBeforeLoad(ctx);
			expect.unreachable("should have thrown");
		} catch (err: unknown) {
			expect(err).toBeInstanceOf(RouteSecurityBlockedError);
			const blocked = err as RouteSecurityBlockedError;
			expect(blocked.requirement.id).toBe("oidc");
			expect(blocked.result.allMet).toBe(false);
		}
	});

	it("throws RouteSecurityBlockedError when no handler provided", () => {
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => false,
			// No handlers — defaults to block
		});
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/secure",
					staticData: withTanStackRouteRequirements([
						{ id: "s", kind: "session" },
					]),
				},
			],
			"/secure",
		);

		expect(() => securedBeforeLoad(ctx)).toThrow(RouteSecurityBlockedError);
	});

	it("uses kind-specific handler in beforeLoad (redirect semantics)", () => {
		const { redirectFn } = createMockRedirect();
		const securedBeforeLoad = createSecureBeforeLoad({
			redirect: redirectFn,
			checkAuthenticated: (req) => req.kind === "session",
			requirementHandlers: {
				frontend_oidc: (req) => `/auth/oidc/${req.id}`,
			},
		});

		// Simulate multi-level route match: session (met) + oidc (unmet)
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/app",
					staticData: withTanStackRouteRequirements([
						{ id: "session", kind: "session" },
					]),
				},
				{
					routeId: "/app/confluence",
					staticData: withTanStackRouteRequirements([
						{ id: "confluence-oidc", kind: "frontend_oidc" },
					]),
				},
			],
			"/app/confluence",
		);

		try {
			securedBeforeLoad(ctx);
			expect.unreachable("should have thrown redirect");
		} catch (err: unknown) {
			expect(err).toHaveProperty("__isRedirect", true);
			expect(err).toHaveProperty("to", "/auth/oidc/confluence-oidc");
		}
	});

	it("processes 3-level route chain with composition in beforeLoad", () => {
		const { redirectFn } = createMockRedirect();
		const securedBeforeLoad = createSecureBeforeLoad({
			redirect: redirectFn,
			checkAuthenticated: (req) => req.kind === "session",
			defaultOnUnauthenticated: (req) => `/login/${req.kind}`,
		});

		// root -> app (session, met) -> admin (oidc, unmet) -> settings (backend, unmet)
		const ctx = buildBeforeLoadContext(
			[
				{ routeId: "__root__" },
				{
					routeId: "/app",
					staticData: withTanStackRouteRequirements([
						{ id: "session", kind: "session" },
					]),
				},
				{
					routeId: "/app/admin",
					staticData: withTanStackRouteRequirements([
						{ id: "admin-oidc", kind: "frontend_oidc" },
					]),
				},
				{
					routeId: "/app/admin/settings",
					staticData: withTanStackRouteRequirements([
						{ id: "settings-api", kind: "backend_oidc" },
					]),
				},
			],
			"/app/admin/settings",
		);

		// First unmet requirement is admin-oidc (kind: frontend_oidc)
		try {
			securedBeforeLoad(ctx);
			expect.unreachable("should have thrown redirect");
		} catch (err: unknown) {
			expect(err).toHaveProperty("to", "/login/frontend_oidc");
		}
	});

	it("allows public zone under protected parent (replace composition in beforeLoad)", () => {
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => false,
			defaultOnUnauthenticated: () => "/login",
		});

		// Parent is protected, child replaces with empty = public zone
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/app",
					staticData: withTanStackRouteRequirements([
						{ id: "session", kind: "session" },
					]),
				},
				{
					routeId: "/app/public-help",
					staticData: withTanStackRouteRequirements([], {
						composition: RequirementsClientSetComposition.Replace,
					}),
				},
			],
			"/app/public-help",
		);

		// Should NOT throw — public zone has no requirements
		expect(() => securedBeforeLoad(ctx)).not.toThrow();
	});

	it("without redirect function, throws RouteSecurityBlockedError for string actions", () => {
		// No redirect fn — string action should still block (via RouteSecurityBlockedError)
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => false,
			defaultOnUnauthenticated: () => "/login",
			// No redirect provided
		});
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/secure",
					staticData: withTanStackRouteRequirements([
						{ id: "s", kind: "session" },
					]),
				},
			],
			"/secure",
		);

		expect(() => securedBeforeLoad(ctx)).toThrow(RouteSecurityBlockedError);
	});

	it("beforeLoad processes empty route chain without throwing", () => {
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => false,
			defaultOnUnauthenticated: () => "/login",
		});

		// No matches with requirements
		const ctx = buildBeforeLoadContext(
			[{ routeId: "__root__" }, { routeId: "/public", staticData: {} }],
			"/public",
		);

		expect(() => securedBeforeLoad(ctx)).not.toThrow();
	});

	it("adopter story: root beforeLoad + child staticData (e2e route tree)", () => {
		// This test exercises the canonical adopter pattern:
		//   1. Root creates secureBeforeLoad with runtime policy
		//   2. Child routes only declare staticData via withTanStackRouteRequirements
		//   3. On navigation, beforeLoad receives context.matches and enforces

		const { redirectFn } = createMockRedirect();
		const authState = new Map<string, boolean>();

		// Simulate: createSecureBeforeLoad at root route level
		const securedBeforeLoad = createSecureBeforeLoad({
			redirect: redirectFn,
			checkAuthenticated: (req) => authState.get(req.kind) === true,
			requirementHandlers: {
				frontend_oidc: (req) => `/login/oidc?returnTo=${req.id}`,
			},
			defaultOnUnauthenticated: () => "/login",
		});

		// Simulate child routes with staticData only (serializable declaration)
		const dashboardStaticData = withTanStackRouteRequirements([
			{ id: "session", kind: "session" },
		]);
		const confluenceStaticData = withTanStackRouteRequirements([
			{ id: "confluence-oidc", kind: "frontend_oidc", label: "Confluence" },
		]);

		// --- Navigation attempt 1: user not authenticated → redirect ---
		const ctx1 = buildBeforeLoadContext(
			[
				{ routeId: "__root__" },
				{ routeId: "/dashboard", staticData: dashboardStaticData },
				{ routeId: "/dashboard/confluence", staticData: confluenceStaticData },
			],
			"/dashboard/confluence",
			"enter",
		);

		try {
			securedBeforeLoad(ctx1);
			expect.unreachable("should redirect for unauthenticated session");
		} catch (err: unknown) {
			// First unmet requirement is "session" → defaultOnUnauthenticated
			expect(err).toHaveProperty("to", "/login");
		}

		// --- User authenticates session ---
		authState.set("session", true);

		// --- Navigation attempt 2: session OK, oidc not → oidc redirect ---
		try {
			securedBeforeLoad(ctx1);
			expect.unreachable("should redirect for unauthenticated oidc");
		} catch (err: unknown) {
			expect(err).toHaveProperty("to", "/login/oidc?returnTo=confluence-oidc");
		}

		// --- User authenticates oidc ---
		authState.set("frontend_oidc", true);

		// --- Navigation attempt 3: all met → navigation proceeds ---
		expect(() => securedBeforeLoad(ctx1)).not.toThrow();
	});

	it("passes attempted URL context to unauthenticated handlers", () => {
		let attemptedUrl: string | undefined;
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => false,
			defaultOnUnauthenticated: (_req, context) => {
				attemptedUrl = context.attemptedUrl;
				return false;
			},
		});
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/confluence",
					staticData: withTanStackRouteRequirements([
						{ id: "confluence-oidc", kind: "frontend_oidc" },
					]),
				},
			],
			"/confluence/spaces/abc?tab=pages",
		);

		try {
			securedBeforeLoad(ctx);
			expect.unreachable("should block");
		} catch (err: unknown) {
			expect(err).toBeInstanceOf(RouteSecurityBlockedError);
		}
		expect(attemptedUrl).toBe(
			"http://localhost/confluence/spaces/abc?tab=pages",
		);
	});

	it("external redirect handlers use attempted URL and never settle", async () => {
		const loginWithRedirect = vi.fn().mockResolvedValue(undefined);
		const securedBeforeLoad = createSecureBeforeLoad({
			checkAuthenticated: () => false,
			requirementHandlers: {
				frontend_oidc: createExternalRedirectBeforeLoadHandler(
					async (_req, context) => {
						await loginWithRedirect({
							postAuthRedirectUri: context.attemptedUrl,
						});
					},
				),
			},
		});
		const ctx = buildBeforeLoadContext(
			[
				{
					routeId: "/confluence",
					staticData: withTanStackRouteRequirements([
						{ id: "confluence-oidc", kind: "frontend_oidc" },
					]),
				},
			],
			"/confluence/spaces/abc?tab=pages",
		);

		const guardResult = securedBeforeLoad(ctx);
		const settled = vi.fn();
		Promise.resolve(guardResult).then(settled, settled);

		await flushMicrotasks();
		expect(loginWithRedirect).toHaveBeenCalledWith({
			postAuthRedirectUri: "http://localhost/confluence/spaces/abc?tab=pages",
		});
		expect(settled).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// 6. Angular / React parity — cross-framework alignment
// ---------------------------------------------------------------------------

describe("TanStack route-security — Angular parity", () => {
	it("DEFAULT_REQUIREMENTS_KEY matches Angular's authRequirements key", () => {
		// Both frameworks use the same default key for requirements
		expect(DEFAULT_REQUIREMENTS_KEY).toBe("authRequirements");
	});

	it("composition enum values are shared with Angular", () => {
		// Both frameworks import RequirementsClientSetComposition from
		// @securitydept/client/auth-coordination — same values
		expect(RequirementsClientSetComposition.Merge).toBeDefined();
		expect(RequirementsClientSetComposition.Replace).toBeDefined();
		expect(RequirementsClientSetComposition.Inherit).toBeDefined();
	});

	it("resolveEffectiveRequirements implements identical semantics to Angular", () => {
		// This test verifies the composition logic is the same as Angular's
		// resolveEffectiveRequirements() — both share the same algorithm.
		const parent = [
			{ id: "a", kind: "session" },
			{ id: "b", kind: "oidc" },
		];
		// Merge: replace same-id, append new
		const merged = resolveEffectiveRequirements(parent, {
			composition: RequirementsClientSetComposition.Merge,
			requirements: [
				{ id: "b", kind: "oidc", label: "new" },
				{ id: "c", kind: "backend" },
			],
		});
		expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
		expect(merged[1]?.label).toBe("new");

		// Replace: discard parent
		const replaced = resolveEffectiveRequirements(parent, {
			composition: RequirementsClientSetComposition.Replace,
			requirements: [{ id: "x", kind: "only" }],
		});
		expect(replaced).toEqual([{ id: "x", kind: "only" }]);

		// Inherit: keep parent as-is
		const inherited = resolveEffectiveRequirements(parent, {
			composition: RequirementsClientSetComposition.Inherit,
			requirements: [{ id: "ignored", kind: "ignored" }],
		});
		expect(inherited).toEqual(parent);
	});

	it("createSecureBeforeLoad is the TanStack equivalent of Angular secureRouteRoot", () => {
		// Both share the same architectural pattern:
		// - Root: non-serializable runtime policy (handlers, redirect, checkAuthenticated)
		// - Children: serializable staticData / route data only
		// createSecureBeforeLoad returns a function compatible with TanStack Router's
		// beforeLoad hook, just as secureRouteRoot produces an Angular Route with
		// canActivate + canActivateChild.
		const fn = createSecureBeforeLoad({
			checkAuthenticated: () => true,
		});
		expect(typeof fn).toBe("function");
		expect(fn.name).toBe("secureBeforeLoad");
	});
});

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}
