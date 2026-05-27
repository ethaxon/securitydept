// Frontend OIDC Mode — web/browser runtime helpers for config-source
//
// Contains all browser-specific convenience helpers that sit on top of
// the core config-source contract. These helpers are intentionally
// separated from config-source.ts to maintain runtime isolation:
//
//   - config-source.ts    → pure contract, no web globals
//   - config-source-web.ts → browser convenience (fetch, globalThis,
//                             idle scheduling, DOM globals)
//
// Adopters who run in non-browser runtimes (SSR, Edge, Workers) can
// import from config-source.ts directly and provide their own source
// factories without pulling in browser assumptions.

import {
	type BaseTransportForStdFetchCreateOptions,
	type BaseTransportTrait,
	ClientError,
	ClientErrorKind,
	createFoundationEnvironment,
	type FoundationEnvironment,
	type IdleCallbackTrait,
	type PageLifecycleTrait,
	type SpanTrait,
	type StorageTrait,
	type TimeTrait,
	type TracingTrait,
	UserRecovery,
} from "@securitydept/client";
import {
	createPersistentStorageForNativeWeb,
	createSessionStorageForNativeWeb,
} from "@securitydept/client/web";
import { type AuthWorkflowRuntimeOptions } from "../../orchestration";
import {
	createFrontendOidcModeClient,
	type FrontendOidcModeClient,
} from "../client/client";
import { type FrontendOidcModeClientConfig } from "../client/types";
import { parseConfigProjection } from "../contracts/contracts";
import {
	type ConfigProjectionSourceBootstrapScript,
	ConfigProjectionSourceKind,
	type ConfigProjectionSourceNetwork,
	type ConfigProjectionSourcePersisted,
	type PersistedConfigEnvelope,
	type ResolvedConfigProjection,
} from "./config-source";

const FRONTEND_OIDC_PERSISTENT_PREFIX =
	"securitydept.web.frontend_oidc:persistent:";
const FRONTEND_OIDC_SESSION_PREFIX = "securitydept.web.frontend_oidc:session:";
const FRONTEND_OIDC_WEB_ENVIRONMENT_ERROR_MESSAGE =
	"frontend-oidc browser materialization requires a browser web environment with origin and fetch.\n" +
	"Create one with createFrontendOidcModeWebClientEnvironment(...).";

export function resolveFrontendOidcModePersistentStateKey(
	config: FrontendOidcModeClientConfig,
): string {
	return (
		config.persistentStateKey ??
		`securitydept.frontend_oidc:v1:${config.issuer}:${config.clientId}`
	);
}

export function resolveFrontendOidcModeBrowserStorageKey(
	config: FrontendOidcModeClientConfig,
	storagePrefix = FRONTEND_OIDC_PERSISTENT_PREFIX,
): string {
	return `${storagePrefix}${resolveFrontendOidcModePersistentStateKey(config)}`;
}

export interface CreateFrontendOidcModeBrowserClientOptions {
	configEndpoint: string;
	redirectUri: string;
	defaultPostAuthRedirectUri?: string;
	environment: FrontendOidcModeWebClientEnvironment;
	authCheck?: AuthWorkflowRuntimeOptions;
}

export interface FrontendOidcModeWebClientEnvironment
	extends FoundationEnvironment {
	origin: string;
	fetch: typeof globalThis.fetch;
	persistentStoragePrefix: string;
}

export interface CreateFrontendOidcModeWebClientEnvironmentOptions {
	environment?: FrontendOidcModeWebClientEnvironment;
	persistentStoragePrefix?: string;
	sessionStoragePrefix?: string;
	persistentStorage?: StorageTrait;
	sessionStorage?: StorageTrait;
	transport?: BaseTransportTrait;
	transportForStdFetchCreateOptions?: BaseTransportForStdFetchCreateOptions;
	span: SpanTrait;
	time?: TimeTrait;
	idleCallback?: IdleCallbackTrait;
	pageLifecycle?: PageLifecycleTrait;
	tracing: TracingTrait;
	origin?: string;
	fetch?: typeof globalThis.fetch;
}

export interface FrontendOidcModeBrowserClientMaterialization {
	client: FrontendOidcModeClient;
	config: FrontendOidcModeClientConfig;
	resolvedProjection: ResolvedConfigProjection;
	browserPersistentStorageKey: string;
}

export function createFrontendOidcModeWebClientEnvironment(
	options: CreateFrontendOidcModeWebClientEnvironmentOptions,
): FrontendOidcModeWebClientEnvironment {
	if (options.environment) {
		return options.environment;
	}

	const persistentStoragePrefix =
		options.persistentStoragePrefix ?? FRONTEND_OIDC_PERSISTENT_PREFIX;
	const sessionStoragePrefix =
		options.sessionStoragePrefix ?? FRONTEND_OIDC_SESSION_PREFIX;
	const environment = createFoundationEnvironment({
		transport: options.transport,
		transportForStdFetchCreateOptions:
			options.transportForStdFetchCreateOptions,
		span: options.span,
		time: options.time,
		idleCallback: options.idleCallback,
		pageLifecycle: options.pageLifecycle,
		tracing: options.tracing,
		persistentStorage:
			options.persistentStorage ??
			requireFrontendOidcWebStorage(
				createPersistentStorageForNativeWeb({
					prefix: persistentStoragePrefix,
				}),
				"localStorage",
			),
		sessionStorage:
			options.sessionStorage ??
			requireFrontendOidcWebStorage(
				createSessionStorageForNativeWeb({
					prefix: sessionStoragePrefix,
				}),
				"sessionStorage",
			),
	});

	return {
		...environment,
		origin: options.origin ?? requireWindowOrigin(),
		fetch: options.fetch ?? requireGlobalFetch(),
		persistentStoragePrefix,
	};
}

/**
 * Materialize a browser-owned frontend OIDC client from a projection endpoint
 * plus browser runtime capabilities.
 */
export async function createFrontendOidcModeBrowserClient(
	options: CreateFrontendOidcModeBrowserClientOptions,
): Promise<FrontendOidcModeBrowserClientMaterialization> {
	const environment = options.environment;
	if (!environment) {
		throw new Error(FRONTEND_OIDC_WEB_ENVIRONMENT_ERROR_MESSAGE);
	}

	const configEndpoint = new URL(options.configEndpoint, environment.origin);
	configEndpoint.searchParams.set("redirect_uri", options.redirectUri);
	const response = await environment.fetch(configEndpoint.toString());
	if (!response.ok) {
		const body = await response.json().catch(() => undefined);
		throw ClientError.fromHttpResponse(response.status, body);
	}

	const projection = await response.json();
	const parsed = parseConfigProjection(projection, {
		redirectUri: options.redirectUri,
		defaultPostAuthRedirectUri: options.defaultPostAuthRedirectUri ?? "/",
	});
	if (!parsed.success) {
		throw new Error(
			"Frontend-mode config projection response did not match the shared projection schema.",
		);
	}

	const resolvedProjection: ResolvedConfigProjection = {
		config: parsed.value,
		sourceKind: ConfigProjectionSourceKind.Network,
		generatedAt:
			typeof projection === "object" &&
			projection !== null &&
			"generatedAt" in projection &&
			typeof (projection as { generatedAt?: unknown }).generatedAt === "number"
				? (projection as { generatedAt: number }).generatedAt
				: undefined,
		rawProjection: projection,
	};

	const client = createFrontendOidcModeClient(
		{
			...parsed.value,
			authCheck: resolveWebAuthWorkflowRuntimeOptions(
				options.authCheck,
				environment,
			),
		},
		environment,
	);

	return {
		client,
		config: parsed.value,
		resolvedProjection,
		browserPersistentStorageKey: resolveFrontendOidcModeBrowserStorageKey(
			parsed.value,
			environment.persistentStoragePrefix,
		),
	};
}

function resolveWebAuthWorkflowRuntimeOptions(
	options: AuthWorkflowRuntimeOptions | undefined,
	environment: FrontendOidcModeWebClientEnvironment,
): AuthWorkflowRuntimeOptions {
	void environment;
	const pageResume = options?.sources?.pageResume ?? ("bundle" as const);
	return {
		...options,
		sources: {
			...options?.sources,
			pageResume,
		},
	};
}

function requireFrontendOidcWebStorage(
	storage: StorageTrait | null,
	hostName: "localStorage" | "sessionStorage",
): StorageTrait {
	if (storage !== null) {
		return storage;
	}
	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		code: "frontend_oidc.web.storage_unavailable",
		message: `Frontend OIDC browser materialization requires globalThis.${hostName}.`,
		recovery: UserRecovery.RestartFlow,
		source: "frontend-oidc-mode",
	});
}

function requireWindowOrigin(): string {
	const windowLike = (globalThis as { window?: unknown }).window;
	const location =
		typeof windowLike === "object" && windowLike !== null
			? (windowLike as { location?: unknown }).location
			: undefined;
	const origin =
		typeof location === "object" && location !== null
			? (location as { origin?: unknown }).origin
			: undefined;
	if (typeof origin !== "string" || origin.length === 0) {
		throw new Error(FRONTEND_OIDC_WEB_ENVIRONMENT_ERROR_MESSAGE);
	}

	return origin;
}

function requireGlobalFetch(): typeof globalThis.fetch {
	if (typeof globalThis.fetch !== "function") {
		throw new Error(FRONTEND_OIDC_WEB_ENVIRONMENT_ERROR_MESSAGE);
	}

	return globalThis.fetch.bind(globalThis);
}

// ---------------------------------------------------------------------------
// Network source: browser fetch
// ---------------------------------------------------------------------------

/**
 * Create a network config projection source from a backend endpoint URL.
 *
 * Uses the browser `fetch` and `URL` APIs to request the projection from
 * the backend's `/api/auth/config` endpoint.
 *
 * @param options.apiEndpoint - Base URL of the API (e.g. `https://api.example.com/api`)
 * @param options.redirectUri - The OIDC callback URL for this browser client
 * @param options.defaultPostAuthRedirectUri - App-level default redirect after auth (default: "/")
 */
export function networkConfigSource(options: {
	apiEndpoint: string;
	redirectUri: string;
	defaultPostAuthRedirectUri?: string;
}): ConfigProjectionSourceNetwork {
	const {
		apiEndpoint,
		redirectUri,
		defaultPostAuthRedirectUri = "/",
	} = options;

	return {
		kind: ConfigProjectionSourceKind.Network,
		fetch: async () => {
			const url = new URL(`${apiEndpoint}/auth/config`);
			url.searchParams.set("redirect_uri", redirectUri);
			const response = await fetch(url.toString());
			if (!response.ok) {
				throw new Error(
					`Config projection fetch failed: ${response.status} ${response.statusText}`,
				);
			}
			return response.json();
		},
		overrides: { redirectUri, defaultPostAuthRedirectUri },
	};
}

// ---------------------------------------------------------------------------
// Bootstrap script source: browser window global
// ---------------------------------------------------------------------------

/**
 * Create a bootstrap script config source that reads an injected window global.
 *
 * This is the canonical web-browser source for server-injected OIDC config
 * projection. The server host writes the projection into the HTML shell
 * before serving, and the client reads it synchronously on startup.
 *
 * **Note:** The `globalKey` has no SDK default — adopters must specify it
 * explicitly. Reference apps like `outposts` use `__OUTPOSTS_CONFIG__`.
 *
 * @param options.globalKey - Window property name holding the injected payload (required)
 * @param options.projectionField - Key within the global object holding the projection (default: `oidc`)
 * @param options.redirectUri - OIDC callback redirect URI override
 * @param options.defaultPostAuthRedirectUri - App-level default redirect after auth
 */
export function bootstrapScriptSource(options: {
	globalKey: string;
	projectionField?: string;
	redirectUri?: string;
	defaultPostAuthRedirectUri?: string;
}): ConfigProjectionSourceBootstrapScript {
	const {
		globalKey,
		projectionField = "oidc",
		redirectUri,
		defaultPostAuthRedirectUri,
	} = options;

	return {
		kind: ConfigProjectionSourceKind.BootstrapScript,
		read: () => {
			const global = (globalThis as Record<string, unknown>)[globalKey];
			if (global == null || typeof global !== "object") return null;
			const container = global as Record<string, unknown>;
			const projection = container[projectionField];
			if (projection == null) return null;
			// Carry authoritative generatedAt from projection itself
			const generatedAt = extractGeneratedAtFromProjection(projection);
			return { __data: projection, __generatedAt: generatedAt };
		},
		overrides: {
			...(redirectUri !== undefined ? { redirectUri } : {}),
			...(defaultPostAuthRedirectUri !== undefined
				? { defaultPostAuthRedirectUri }
				: {}),
		},
	};
}

// ---------------------------------------------------------------------------
// Persisted source: read from abstract StorageTrait
// ---------------------------------------------------------------------------

/**
 * Create a persisted config source that reads from an abstract StorageTrait.
 *
 * The persisted source stores config projections as JSON envelopes
 * containing both the raw projection data and the authoritative `generatedAt`
 * timestamp from the backend.
 *
 * @param options.store - Abstract StorageTrait (e.g. from `createPersistentStorageForNativeWeb`)
 * @param options.storageKey - Key within the store
 * @param options.redirectUri - OIDC callback redirect URI override
 * @param options.defaultPostAuthRedirectUri - App-level default redirect after auth
 */
export function persistedConfigSource(options: {
	store: StorageTrait;
	storageKey: string;
	redirectUri?: string;
	defaultPostAuthRedirectUri?: string;
}): ConfigProjectionSourcePersisted {
	const { store, storageKey, redirectUri, defaultPostAuthRedirectUri } =
		options;

	return {
		kind: ConfigProjectionSourceKind.Persisted,
		restore: async () => {
			const raw = await store.get(storageKey);
			if (raw === null) return null;
			try {
				const envelope = JSON.parse(raw) as PersistedConfigEnvelope;
				if (!envelope.data) return null;
				return {
					__data: envelope.data,
					__generatedAt: envelope.generatedAt,
				};
			} catch {
				return null;
			}
		},
		overrides: {
			...(redirectUri !== undefined ? { redirectUri } : {}),
			...(defaultPostAuthRedirectUri !== undefined
				? { defaultPostAuthRedirectUri }
				: {}),
		},
	};
}

// ---------------------------------------------------------------------------
// Persist resolved config to abstract StorageTrait
// ---------------------------------------------------------------------------

/**
 * Persist a resolved config projection to an abstract StorageTrait.
 *
 * Stores the raw projection data and its authoritative `generatedAt` so that
 * `persistedConfigSource` can restore it on next boot and revalidation can
 * check freshness against the projection's own generation time.
 *
 * @param store - Abstract StorageTrait to write to
 * @param storageKey - Key within the store
 * @param resolved - The resolved config projection (must include `rawProjection`)
 */
export async function persistConfigProjection(
	store: StorageTrait,
	storageKey: string,
	resolved: ResolvedConfigProjection,
): Promise<void> {
	if (resolved.rawProjection === undefined) return;
	const envelope: PersistedConfigEnvelope = {
		data: resolved.rawProjection,
		generatedAt: resolved.generatedAt ?? 0,
	};
	await store.set(storageKey, JSON.stringify(envelope));
}

// ---------------------------------------------------------------------------
// Idle revalidation: freshness-aware background re-fetch
// ---------------------------------------------------------------------------

/**
 * Options for `scheduleIdleRevalidation`.
 */
export interface IdleRevalidationOptions {
	/**
	 * The network source to re-fetch from.
	 */
	networkSource: ConfigProjectionSourceNetwork;
	/**
	 * Explicit time capability used for freshness checks and persisted metadata.
	 */
	time: TimeTrait;
	/**
	 * Optional idle callback capability. If absent, no idle revalidation is
	 * scheduled.
	 */
	idleCallback?: IdleCallbackTrait;
	/**
	 * Abstract StorageTrait to persist revalidated config to.
	 */
	store: StorageTrait;
	/**
	 * Storage key for persisted config.
	 */
	storageKey: string;
	/**
	 * Max age in milliseconds before a source is considered stale.
	 * Default: 300_000 (5 minutes).
	 */
	maxAge?: number;
	/**
	 * Authoritative projection `generatedAt` timestamp (epoch-ms).
	 * If absent or if `time.now() - generatedAt > maxAge`, revalidation fires.
	 */
	generatedAt?: number;
}

/**
 * Schedule idle-time revalidation of a config projection.
 *
 * Only triggers a network fetch if the current projection is stale
 * (`generatedAt + maxAge < now`) and an explicit idle callback capability was
 * provided.
 *
 * On success: writes the fresh projection to the store.
 * On failure: silently retains the existing cache (no disruption).
 *
 * @returns A cancellation function, or `undefined` if revalidation was
 *          skipped (source is still fresh).
 */
export function scheduleIdleRevalidation(
	options: IdleRevalidationOptions,
): (() => void) | undefined {
	const {
		networkSource,
		time,
		idleCallback,
		store,
		storageKey,
		maxAge = 300_000,
		generatedAt,
	} = options;

	// Skip if source is still fresh based on authoritative generation time
	const now = time.now();
	if (generatedAt !== undefined && now - generatedAt <= maxAge) {
		return undefined;
	}

	if (!idleCallback) {
		return undefined;
	}

	const doRevalidate = async () => {
		try {
			const raw = await networkSource.fetch();
			// Extract generatedAt from the fresh projection for the envelope
			const freshGeneratedAt =
				extractGeneratedAtFromProjection(raw) ?? time.now();
			const envelope: PersistedConfigEnvelope = {
				data: raw,
				generatedAt: freshGeneratedAt,
			};
			await store.set(storageKey, JSON.stringify(envelope));
		} catch {
			// Silently retain existing cache
		}
	};

	const id = idleCallback.requestIdleCallback(() => {
		void doRevalidate();
	});
	return () => idleCallback.cancelIdleCallback(id);
}

// ---------------------------------------------------------------------------
// Internal: extract generatedAt from raw projection
// ---------------------------------------------------------------------------

function extractGeneratedAtFromProjection(raw: unknown): number | undefined {
	if (
		typeof raw === "object" &&
		raw !== null &&
		"generatedAt" in raw &&
		typeof (raw as Record<string, unknown>).generatedAt === "number"
	) {
		return (raw as Record<string, unknown>).generatedAt as number;
	}
	return undefined;
}

// Re-export type needed for overrides parameter inference
export type { FrontendOidcModeClientConfig };
