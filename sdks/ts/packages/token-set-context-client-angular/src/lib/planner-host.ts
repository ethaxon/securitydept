// Token-set requirement planner host — Angular DI behaviour provider
//
// Canonical import path:
//   import { provideTokenSetRequirementPlannerHost }
//     from "@securitydept/token-set-context-client-angular"
//
// Provides a token-set-specialized RequirementPlannerHost to the generic
// client-angular REQUIREMENT_PLANNER_HOST token. The host behaviour maps
// requirement metadata onto TokenSetAuthRegistry clients:
//   - checkAuthenticated: resolve requirement -> registry clients, wait for the
//     initial (restore-phase) auth determination, then require all
//     authenticated.
//   - onUnauthenticated: resolve failing entries, pick the handler (per-id
//     policy > per-kind handler > default), and run it inside the captured
//     injection context.
//
// Client resolution order for a requirement:
//   1. requirementPolicies[id].selector.clientKey  (explicit key)
//   2. requirementPolicies[id].selector.query      (composite query)
//   3. registry.clientRecordGenForQuery({ requirementKind })  (kind mapping)
//
// The requirement kind lives in AuthRequirement.attributes.requirementKind
// (the coordination layer no longer carries a top-level `kind`).
//
// Stability: provisional

import {
	EnvironmentInjector,
	type EnvironmentProviders,
	inject,
	runInInjectionContext,
} from "@angular/core";
import { Router, type UrlTree } from "@angular/router";
import {
	type AuthRequirement,
	type FoundationEnvironment,
	type RequirementBehaviour,
} from "@securitydept/client";
import {
	ENVIRONMENT,
	provideRequirementPlannerHost,
} from "@securitydept/client-angular";
import { type OidcRedirectLoginOptions } from "@securitydept/token-set-context-client/orchestration";
import { type TokenSetAngularClient } from "./contracts";
import {
	type ClientMeta,
	type ClientQueryOptions,
	TokenSetAuthRegistry,
} from "./token-set-auth.registry";

/**
 * Attribute key under {@link AuthRequirement.attributes} that carries the
 * token-set requirement kind used for the default registry mapping.
 */
export const TOKEN_SET_REQUIREMENT_KIND_ATTRIBUTE = "requirementKind";

// ---------------------------------------------------------------------------
// Handler / policy contracts
// ---------------------------------------------------------------------------

/**
 * A failing entry handed to `onUnauthenticated` when one or more clients
 * could not be verified as authenticated.
 */
export interface UnauthenticatedEntry {
	/** The unauthenticated token-set client. */
	readonly client: TokenSetAngularClient;
	/** The client key for this client. */
	readonly clientKey: string;
	/** Full client metadata (urlPatterns, callbackPath, requirementKind, providerFamily). */
	readonly meta: ClientMeta;
}

/**
 * How to select a token-set client from the registry for a specific requirement.
 *
 * Choose exactly one:
 * - `clientKey` — direct key lookup (explicit, single client)
 * - `query` — composite filter query ({@link ClientQueryOptions})
 */
export type TokenSetClientSelector =
	| { clientKey: string; query?: never }
	| { clientKey?: never; query: ClientQueryOptions };

/**
 * Runtime context passed to unauthenticated route handlers.
 *
 * `attemptedUrl` is the Angular Router target URL for the navigation being
 * guarded (resolved from the in-progress navigation). Use it as
 * `postAuthRedirectUri`; do not read `Router.url`, which still points at the
 * previously active page while a guard is deciding.
 */
export interface TokenSetRouteUnauthenticatedContext {
	readonly attemptedUrl: string;
}

export type TokenSetRouteUnauthenticatedHandler = (
	unauthenticated: ReadonlyArray<UnauthenticatedEntry>,
	requirement: AuthRequirement,
	context: TokenSetRouteUnauthenticatedContext,
) => boolean | string | UrlTree | Promise<boolean | string | UrlTree>;

/**
 * Policy override for a specific requirement ID.
 *
 * - `selector` overrides the default kind→client registry lookup.
 * - `onUnauthenticated` overrides both `requirementHandlers[kind]` and
 *   `defaultOnUnauthenticated` for this exact requirement.
 */
export interface TokenSetRequirementPolicy {
	/** Override the default kind→client registry lookup for this requirement. */
	selector?: TokenSetClientSelector;
	/** Handler called when this requirement is selected as unauthenticated. */
	onUnauthenticated: TokenSetRouteUnauthenticatedHandler;
}

/** Options for {@link provideTokenSetRequirementPlannerHost}. */
export interface ProvideTokenSetRequirementPlannerHostOptions {
	/**
	 * Per-requirement-id policies. Keys are `AuthRequirement.id`. Take
	 * precedence over {@link requirementHandlers} and
	 * {@link defaultOnUnauthenticated}.
	 */
	requirementPolicies?: Record<string, TokenSetRequirementPolicy>;
	/**
	 * Per-requirement-kind handlers. Keys are the token-set requirement kind
	 * (`attributes.requirementKind`).
	 */
	requirementHandlers?: Record<string, TokenSetRouteUnauthenticatedHandler>;
	/**
	 * Fallback handler when no `requirementPolicies[id]` or
	 * `requirementHandlers[kind]` matches the pending requirement.
	 */
	defaultOnUnauthenticated?: TokenSetRouteUnauthenticatedHandler;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Provide a token-set {@link RequirementBehaviour} host to the client-angular
 * `REQUIREMENT_PLANNER_HOST` token.
 *
 * Mount this at the route/app scope that owns a {@link TokenSetAuthRegistry};
 * the generic Angular guards then resolve their behaviour through it.
 */
export function provideTokenSetRequirementPlannerHost(
	options: ProvideTokenSetRequirementPlannerHostOptions = {},
): EnvironmentProviders {
	return provideRequirementPlannerHost(() => {
		const registry = inject(TokenSetAuthRegistry);
		const injector = inject(EnvironmentInjector);
		const router = inject(Router);
		return createTokenSetRequirementBehaviour(
			options,
			registry,
			injector,
			router,
		);
	});
}

function createTokenSetRequirementBehaviour(
	options: ProvideTokenSetRequirementPlannerHostOptions,
	registry: TokenSetAuthRegistry,
	injector: EnvironmentInjector,
	router: Router,
): Partial<RequirementBehaviour> {
	return {
		checkAuthenticated: async (requirement) => {
			const selector = options.requirementPolicies?.[requirement.id]?.selector;
			const entries = await resolveRequirementEntries(
				registry,
				requirement,
				selector,
			);
			// Unmapped requirement: treat as satisfied so unrelated requirements can
			// coexist on the same route chain without blocking the guard.
			if (entries.length === 0) {
				return true;
			}
			await Promise.all(
				entries.map((entry) => waitForInitialAuthDetermination(entry.client)),
			);
			return entries.every((entry) => readClientAuthentication(entry.client));
		},
		onUnauthenticated: async (requirement) => {
			const policy = options.requirementPolicies?.[requirement.id];
			const entries = await resolveRequirementEntries(
				registry,
				requirement,
				policy?.selector,
			);
			const failing = entries.filter(
				(entry) => !readClientAuthentication(entry.client),
			);
			const kind = readRequirementKind(requirement);
			const handler =
				policy?.onUnauthenticated ??
				(kind !== undefined
					? options.requirementHandlers?.[kind]
					: undefined) ??
				options.defaultOnUnauthenticated;
			if (!handler) {
				return false;
			}
			const context: TokenSetRouteUnauthenticatedContext = {
				attemptedUrl: resolveAttemptedUrl(router),
			};
			const action = await runInInjectionContext(injector, () =>
				handler(failing, requirement, context),
			);
			if (typeof action === "boolean" || typeof action === "string") {
				return action;
			}
			return router.serializeUrl(action);
		},
	};
}

// ---------------------------------------------------------------------------
// Requirement -> registry client resolution
// ---------------------------------------------------------------------------

function readRequirementKind(requirement: AuthRequirement): string | undefined {
	const kind = requirement.attributes?.[TOKEN_SET_REQUIREMENT_KIND_ATTRIBUTE];
	return typeof kind === "string" ? kind : undefined;
}

async function resolveRequirementEntries(
	registry: TokenSetAuthRegistry,
	requirement: AuthRequirement,
	selector: TokenSetClientSelector | undefined,
): Promise<UnauthenticatedEntry[]> {
	const recordSignals = resolveClientRecordSignals(
		registry,
		requirement,
		selector,
	);
	return Promise.all(
		recordSignals.map(async (recordSignal) => {
			const record = recordSignal.get();
			return {
				// initialize() waits for an in-flight async clientFactory rather than
				// reading a possibly-uninitialized client synchronously.
				client: await registry.initialize(record.meta.clientKey),
				clientKey: record.meta.clientKey,
				meta: record.meta,
			};
		}),
	);
}

function resolveClientRecordSignals(
	registry: TokenSetAuthRegistry,
	requirement: AuthRequirement,
	selector: TokenSetClientSelector | undefined,
): ReturnType<TokenSetAuthRegistry["clientRecordFor"]>[] {
	if (selector) {
		if (selector.clientKey) {
			const record = registry.clientRecordOptionFor(selector.clientKey);
			return record ? [record] : [];
		}
		if (selector.query) {
			return [...registry.clientRecordGenForQuery(selector.query)];
		}
		return [];
	}
	const kind = readRequirementKind(requirement);
	if (kind === undefined) {
		return [];
	}
	return [...registry.clientRecordGenForQuery({ requirementKind: kind })];
}

// ---------------------------------------------------------------------------
// Authentication channel reads
// ---------------------------------------------------------------------------

function readAuthenticationChannel(source: {
	isAuthenticated: unknown;
}): boolean {
	if (
		typeof source.isAuthenticated === "object" &&
		source.isAuthenticated !== null &&
		"get" in source.isAuthenticated &&
		typeof source.isAuthenticated.get === "function"
	) {
		const value = source.isAuthenticated.get();
		if (
			typeof value === "object" &&
			value !== null &&
			"kind" in value &&
			(value.kind === "empty" || value.kind === "value")
		) {
			if (value.kind === "empty" || !("value" in value)) {
				return false;
			}
			return Boolean(value.value);
		}
		return Boolean(value);
	}
	if (typeof source.isAuthenticated === "function") {
		return source.isAuthenticated();
	}
	return Boolean(source.isAuthenticated);
}

function readClientAuthentication(
	client: Pick<TokenSetAngularClient, "isAuthenticated">,
): boolean {
	return readAuthenticationChannel(client);
}

async function waitForInitialAuthDetermination(
	client: TokenSetAngularClient,
): Promise<void> {
	if (client.authDetermined.hasValue()) {
		return;
	}
	if (!client.authOperations.restorePending.get()) {
		return;
	}
	await client.authDetermined.whenValue();
}

// ---------------------------------------------------------------------------
// Attempted URL resolution
// ---------------------------------------------------------------------------

function resolveAttemptedUrl(router: Router): string {
	const navigation = router.getCurrentNavigation?.();
	const target = navigation?.finalUrl ?? navigation?.extractedUrl;
	if (target) {
		return router.serializeUrl(target);
	}
	return router.url ?? "/";
}

// ---------------------------------------------------------------------------
// OIDC redirect-login handler
// ---------------------------------------------------------------------------

/**
 * Options for {@link createTokenSetOidcLoginRedirectHandler}.
 */
export interface CreateTokenSetOidcLoginRedirectHandlerOptions {
	/**
	 * Explicit client key. When omitted, the first failing registry entry is
	 * used (the common one-client-per-requirement case).
	 */
	clientKey?: string;
	/**
	 * Optional stable environment override. The canonical path is to provide the
	 * host-owned native web environment once via `provideEnvironment(...)`.
	 */
	environment?: FoundationEnvironment;
	/**
	 * Fallback used only when no attempted URL is available.
	 * @default "/"
	 */
	fallbackPostAuthRedirectUri?: string;
}

/**
 * Build a route-security handler that starts OIDC redirect login and records
 * the attempted navigation URL as `postAuthRedirectUri`.
 *
 * After the browser redirect starts, the returned result intentionally never
 * settles so Angular does not finalize the rejected in-app navigation while the
 * page is already leaving for an external IdP.
 */
export function createTokenSetOidcLoginRedirectHandler(
	options: CreateTokenSetOidcLoginRedirectHandlerOptions = {},
): TokenSetRouteUnauthenticatedHandler {
	return async (unauthenticated, _requirement, context) => {
		const clientKey = options?.clientKey ?? unauthenticated[0]?.clientKey;
		if (!clientKey) {
			return false;
		}
		resolveOidcRouteEnvironment(options?.environment);

		const registry = inject(TokenSetAuthRegistry);
		const client = await registry.initialize(clientKey);
		if (!isLoginWithRedirectClient(client)) {
			failMissingOidcRedirectLoginCapability(clientKey);
		}
		await client.loginWithRedirect({
			postAuthRedirectUri:
				context.attemptedUrl || options?.fallbackPostAuthRedirectUri || "/",
		});
		return await neverSettlingRedirectGuardResult();
	};
}

function neverSettlingRedirectGuardResult(): Promise<never> {
	return new Promise<never>(() => {
		// Intentionally never resolves: a full-page browser redirect is in progress.
	});
}

function resolveOidcRouteEnvironment(
	environmentOverride: FoundationEnvironment | undefined,
): void {
	const environment =
		environmentOverride ??
		inject(ENVIRONMENT, { optional: true }) ??
		failMissingOidcRouteEnvironment();
	if (!environment.router) {
		failMissingOidcRouteEnvironment();
	}
}

function failMissingOidcRouteEnvironment(): never {
	throw new Error(
		"createTokenSetOidcLoginRedirectHandler requires an explicit environment.\n" +
			"Provide the host-owned environment once from the Angular composition root with provideEnvironment({ environment }).\n" +
			"or pass a stable environment override with createTokenSetOidcLoginRedirectHandler({ environment: ... }).",
	);
}

function failMissingOidcRedirectLoginCapability(clientKey: string): never {
	throw new Error(
		`createTokenSetOidcLoginRedirectHandler requires client key "${clientKey}" to implement loginWithRedirect(options).`,
	);
}

function isLoginWithRedirectClient(client: unknown): client is {
	loginWithRedirect(options?: OidcRedirectLoginOptions): Promise<void>;
} {
	return (
		typeof client === "object" &&
		client !== null &&
		"loginWithRedirect" in client &&
		typeof client.loginWithRedirect === "function"
	);
}
