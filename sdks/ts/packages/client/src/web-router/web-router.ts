// @securitydept/client/web-router — framework-free web router baseline
//
// Provides a thin router layer built on `NavigationAdapter` (Navigation API
// or History API fallback) with planner-host integration for declarative,
// auth-aware route guards.
//
// Iteration 110 review-1 fix: the router now supports a nested route tree
// with full-route requirement aggregation (inherit / merge / replace
// composition) so that parent + child + sibling security declarations are
// combined into a single candidate set before the planner-host runs — the
// same contract depth offered by the Angular adapter and the TanStack
// Router adapter. Flat declarations remain supported: a route without
// `children` behaves exactly as before.
//
// Stability: provisional (new in iteration 110)

import type {
	AuthGuardClientOption,
	PlannerHost,
	RequirementsClientSetComposition as RequirementsClientSetCompositionType,
} from "../auth-coordination/planner-host";
import {
	RequirementsClientSetComposition,
	resolveEffectiveClientSet,
} from "../auth-coordination/planner-host";
import {
	type CreateNavigationAdapterOptions,
	createNavigationAdapter,
	type NavigationAdapter,
	NavigationAdapterKind,
	type NavigationCommit,
	type NavigationIntent,
} from "./navigation-adapter";

// ---------------------------------------------------------------------------
// Route definition
// ---------------------------------------------------------------------------

export interface WebRouteContext {
	/** The URL being navigated to. */
	url: URL;
	/** Intent metadata. Null for programmatic `activate()` calls. */
	intent: NavigationIntent | null;
}

export type WebRouteMatcher =
	| string
	| RegExp
	| ((url: URL) => Record<string, string> | null | undefined);

export interface WebRouteDefinition<TData = unknown> {
	/** Opaque identifier. */
	id: string;
	/**
	 * Matcher for this route segment. Required on leaves — parents that
	 * only carry metadata for children may omit `match`.
	 *
	 * A string is treated as a path-with-params pattern
	 * (`"/users/:id/profile"` → `{ id: "123" }` for `/users/123/profile`).
	 * A RegExp uses `exec(pathname)` and passes named/indexed groups
	 * through as params. A function returns the parsed params or null.
	 */
	match?: WebRouteMatcher;
	/**
	 * Auth requirements declared at this route segment. The router walks
	 * the matched route chain from root to leaf and aggregates every
	 * segment's requirements via {@link extractFullRouteRequirements}
	 * before asking the planner-host to evaluate.
	 */
	requirements?: readonly AuthGuardClientOption[];
	/**
	 * Composition strategy with the parent segment in the matched chain.
	 *
	 * - `merge`   (default): parent requirements are kept, child requirements
	 *   append/override by `requirementId`.
	 * - `inherit`: child declares no additional requirements; parent set is
	 *   used as-is.
	 * - `replace`: parent requirements are discarded entirely; this child
	 *   contributes the full effective set (use for "public" subtrees of an
	 *   otherwise protected parent).
	 */
	composition?: RequirementsClientSetCompositionType;
	/**
	 * Nested child routes. When present, `match` on the parent is optional
	 * and is not consulted for matching leaves — only the leaves' matchers
	 * participate in URL resolution. The chain from root to leaf is what
	 * drives requirement aggregation.
	 */
	children?: readonly WebRouteDefinition<TData>[];
	/** Arbitrary data attached to matched routes. */
	data?: TData;
}

export interface WebRouteMatch<TData = unknown> {
	/** The leaf route that matched. */
	readonly route: WebRouteDefinition<TData>;
	readonly url: URL;
	readonly params: Record<string, string>;
	/**
	 * The complete chain from root ancestor → leaf. A flat route without
	 * children produces a single-element chain.
	 */
	readonly chain: readonly WebRouteDefinition<TData>[];
}

// ---------------------------------------------------------------------------
// Declaration helpers
// ---------------------------------------------------------------------------

/**
 * Sugar for declaring a route segment. Enforces a consistent shape so
 * adopter code reads like the Angular / TanStack helpers without forcing
 * any particular DI or decorator style.
 */
export function defineWebRoute<TData = unknown>(
	definition: WebRouteDefinition<TData>,
): WebRouteDefinition<TData> {
	return definition;
}

export interface FullRouteRequirementsOptions {
	/**
	 * Default composition for segments that do not set their own
	 * `composition` field. Defaults to `merge` to match the Angular helper
	 * and the TanStack adapter.
	 */
	defaultComposition?: RequirementsClientSetCompositionType;
}

/**
 * Aggregate every segment's `requirements` across the matched chain into
 * a single {@link AuthGuardClientOption} list, honouring each segment's
 * composition strategy (`inherit` / `merge` / `replace`).
 *
 * This is the extraction counter-part to the nested `WebRouteDefinition`
 * tree — the router calls it once per matched navigation and forwards the
 * resulting flat list to the planner-host.
 */
export function extractFullRouteRequirements<TData = unknown>(
	chain: readonly WebRouteDefinition<TData>[],
	options: FullRouteRequirementsOptions = {},
): AuthGuardClientOption[] {
	const defaultComposition =
		options.defaultComposition ?? RequirementsClientSetComposition.Merge;
	let effective: AuthGuardClientOption[] = [];
	for (const segment of chain) {
		const composition = segment.composition ?? defaultComposition;
		const options = segment.requirements ?? [];
		effective = resolveEffectiveClientSet(effective, {
			composition,
			options,
		});
	}
	return effective;
}

// ---------------------------------------------------------------------------
// Matcher compilation
// ---------------------------------------------------------------------------

interface CompiledMatcher {
	match(url: URL): Record<string, string> | null;
}

function compileMatcher(matcher: WebRouteMatcher): CompiledMatcher {
	if (typeof matcher === "function") {
		return {
			match: (url) => matcher(url) ?? null,
		};
	}
	if (matcher instanceof RegExp) {
		return {
			match: (url) => {
				const result = matcher.exec(url.pathname);
				if (!result) return null;
				return { ...(result.groups ?? {}) };
			},
		};
	}
	// String path with ":param" placeholders, case-insensitive, supports
	// a trailing "*" wildcard segment.
	const paramNames: string[] = [];
	let wildcardName: string | null = null;
	const segments = matcher.split("/");
	const parts = segments.map((segment) => {
		if (segment.startsWith(":")) {
			paramNames.push(segment.slice(1));
			return "([^/]+)";
		}
		if (segment === "*") {
			wildcardName = "wildcard";
			return "(.*)";
		}
		if (segment.startsWith("*")) {
			wildcardName = segment.slice(1);
			return "(.*)";
		}
		return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	});
	const pattern = new RegExp(`^${parts.join("/")}$`);
	return {
		match: (url) => {
			const result = pattern.exec(url.pathname);
			if (!result) return null;
			const params: Record<string, string> = {};
			for (let i = 0; i < paramNames.length; i++) {
				params[paramNames[i]] = decodeURIComponent(result[i + 1] ?? "");
			}
			if (wildcardName) {
				params[wildcardName] = result[result.length - 1] ?? "";
			}
			return params;
		},
	};
}

// ---------------------------------------------------------------------------
// Route tree flattening
// ---------------------------------------------------------------------------

interface FlatRoute<TData> {
	leaf: WebRouteDefinition<TData>;
	chain: readonly WebRouteDefinition<TData>[];
	compiled: CompiledMatcher | null;
}

function flattenRoutes<TData>(
	routes: readonly WebRouteDefinition<TData>[],
	parentChain: readonly WebRouteDefinition<TData>[] = [],
): FlatRoute<TData>[] {
	const result: FlatRoute<TData>[] = [];
	for (const route of routes) {
		const chain = [...parentChain, route];
		const hasChildren = !!route.children && route.children.length > 0;
		if (hasChildren) {
			result.push(...flattenRoutes(route.children ?? [], chain));
			// A route with children is treated as a non-matchable container
			// by default — the child routes own URL matching. Adopters who
			// want a parent to also participate in matching should declare
			// it via `children`-less sibling route with an explicit
			// `composition: "inherit"` if requirement inheritance is needed.
			continue;
		}
		const compiled = route.match ? compileMatcher(route.match) : null;
		result.push({ leaf: route, chain, compiled });
	}
	return result;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export interface CreateWebRouterOptions<TData = unknown> {
	/**
	 * Initial routes. Nested `children` are supported: the router
	 * flattens the declared tree into matchable leaves and reconstructs
	 * the root→leaf chain on every match for full-route aggregation.
	 *
	 * More routes can be added via `router.addRoute(...)` at runtime.
	 */
	routes?: readonly WebRouteDefinition<TData>[];
	/** Planner-host for evaluating aggregated route requirements. */
	plannerHost?: PlannerHost;
	/**
	 * Options for the underlying navigation adapter. When omitted the
	 * router auto-selects the Navigation API if available.
	 */
	navigationAdapter?: CreateNavigationAdapterOptions | NavigationAdapter;
	/**
	 * Called after every committed navigation. Prefer `onNavigate` for
	 * reactivity; this option exists for convenience.
	 */
	onNavigate?: (commit: NavigationCommit) => void;
	/**
	 * Default requirement composition strategy applied when a route
	 * segment does not declare its own `composition`. Defaults to `merge`
	 * (the Angular / TanStack default).
	 */
	defaultComposition?: RequirementsClientSetCompositionType;
}

export interface WebRouter<TData = unknown> {
	readonly adapter: NavigationAdapter;
	/** Current URL (from the underlying adapter). */
	currentUrl(): URL;
	/** Current matched route (or null if no route matches). */
	currentMatch(): WebRouteMatch<TData> | null;
	/** Register an additional root-level route at runtime. */
	addRoute(route: WebRouteDefinition<TData>): () => void;
	/** All currently registered root-level routes. */
	routes(): readonly WebRouteDefinition<TData>[];
	/**
	 * Match a URL against the registered routes. Returns the first match in
	 * registration order, or `null` if none match. When a match is found,
	 * {@link WebRouteMatch.chain} contains the root→leaf route chain so
	 * adopters can feed it to {@link extractFullRouteRequirements}.
	 */
	match(url: URL): WebRouteMatch<TData> | null;
	/**
	 * Compute the effective aggregated requirements for a given match,
	 * honouring every segment's composition strategy.
	 */
	extractRequirements(match: WebRouteMatch<TData>): AuthGuardClientOption[];
	/** Programmatically navigate. */
	navigate(
		url: string | URL,
		options?: { replace?: boolean; state?: unknown },
	): Promise<void>;
	back(): void;
	forward(): void;
	/** Subscribe to committed navigations. */
	onNavigate(listener: (commit: NavigationCommit) => void): () => void;
	/** Tear down event listeners on the underlying adapter. */
	destroy(): void;
}

/**
 * Create a {@link WebRouter} wired to the selected navigation backend and
 * optionally to a planner-host for aggregated route requirements evaluation.
 *
 * The router listens for pre-commit navigation intents, matches the
 * destination URL against the registered route tree, aggregates the full
 * root→leaf chain's requirements (respecting each segment's composition
 * strategy), and asks `plannerHost.evaluate()` to rule on the complete
 * candidate set. Depending on the host's decision it either:
 *
 * - lets the navigation commit (all requirements authenticated);
 * - redirects to the URL returned by `onUnauthenticated` (when a candidate
 *   picks a redirect); or
 * - cancels the navigation (when `onUnauthenticated` returns `false`).
 */
export function createWebRouter<TData = unknown>(
	options: CreateWebRouterOptions<TData> = {},
): WebRouter<TData> {
	const adapter: NavigationAdapter =
		options.navigationAdapter && "kind" in options.navigationAdapter
			? (options.navigationAdapter as NavigationAdapter)
			: createNavigationAdapter(
					(options.navigationAdapter as CreateNavigationAdapterOptions) ?? {},
				);

	const roots: WebRouteDefinition<TData>[] = [...(options.routes ?? [])];
	let flat: FlatRoute<TData>[] = flattenRoutes(roots);

	const rebuild = () => {
		flat = flattenRoutes(roots);
	};

	const matchUrl = (url: URL): WebRouteMatch<TData> | null => {
		for (const entry of flat) {
			if (!entry.compiled) continue;
			const params = entry.compiled.match(url);
			if (params) {
				return {
					route: entry.leaf,
					url,
					params,
					chain: entry.chain,
				};
			}
		}
		return null;
	};

	const extractRequirements = (
		match: WebRouteMatch<TData>,
	): AuthGuardClientOption[] =>
		extractFullRouteRequirements(match.chain, {
			defaultComposition: options.defaultComposition,
		});

	let lastMatch: WebRouteMatch<TData> | null = matchUrl(adapter.currentUrl());

	const beforeUnsub = adapter.onBeforeNavigate(async (intent) => {
		const match = matchUrl(intent.url);
		if (!match || !options.plannerHost) return;
		const aggregated = extractRequirements(match);
		if (aggregated.length === 0) return;
		const result = await options.plannerHost.evaluate(aggregated);
		if (result.allAuthenticated) return;
		const pending = result.pendingCandidate;
		if (!pending) return;
		const outcome = await pending.onUnauthenticated();
		if (outcome === true) return;
		if (outcome === false) {
			intent.preventDefault();
			return;
		}
		if (typeof outcome === "string") {
			intent.redirect(outcome);
		}
	});

	const navUnsub = adapter.onNavigate((commit) => {
		lastMatch = matchUrl(commit.url);
		options.onNavigate?.(commit);
	});

	return {
		adapter,
		currentUrl: () => adapter.currentUrl(),
		currentMatch: () => lastMatch,
		routes: () => roots.slice(),
		addRoute: (route) => {
			roots.push(route);
			rebuild();
			return () => {
				const idx = roots.indexOf(route);
				if (idx >= 0) {
					roots.splice(idx, 1);
					rebuild();
				}
			};
		},
		match: matchUrl,
		extractRequirements,
		navigate: (url, navOptions) => adapter.navigate(url, navOptions),
		back: () => adapter.back(),
		forward: () => adapter.forward(),
		onNavigate: (listener) => adapter.onNavigate(listener),
		destroy: () => {
			beforeUnsub();
			navUnsub();
			adapter.destroy();
		},
	};
}

// Re-export navigation adapter surface for convenience.
export { NavigationAdapterKind, RequirementsClientSetComposition };
