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
	ClientError,
	type Clock,
	type HttpTransport,
	type LoggerTrait,
	type RecordStore,
	type Scheduler,
	type TraceEventSinkTrait,
} from "@securitydept/client";
import {
	createLocalStorageStore,
	createSessionStorageStore,
} from "@securitydept/client/persistence/web";
import {
	createWebRuntime,
	type FetchTransportOptions,
} from "@securitydept/client/web";
import {
	attachTokenSetResumeReconciliation,
	type TokenSetResumeReconciliationOptions,
} from "../orchestration";
import {
	createFrontendOidcModeClient,
	type FrontendOidcModeClient,
} from "./client";
import type {
	ConfigProjectionSourceBootstrapScript,
	ConfigProjectionSourceNetwork,
	ConfigProjectionSourcePersisted,
	PersistedConfigEnvelope,
	ResolvedConfigProjection,
} from "./config-source";
import { ConfigProjectionSourceKind } from "./config-source";
import { parseConfigProjection } from "./contracts";
import type { FrontendOidcModeClientConfig } from "./types";

const FRONTEND_OIDC_PERSISTENT_PREFIX =
	"securitydept.web.frontend_oidc:persistent:";
const FRONTEND_OIDC_SESSION_PREFIX = "securitydept.web.frontend_oidc:session:";

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
	persistentStoragePrefix?: string;
	sessionStoragePrefix?: string;
	persistentStore?: RecordStore;
	sessionStore?: RecordStore;
	transport?: HttpTransport;
	fetchTransport?: FetchTransportOptions;
	scheduler?: Scheduler;
	clock?: Clock;
	logger?: LoggerTrait;
	traceSink?: TraceEventSinkTrait;
	resumeReconciliation?: boolean;
	resumeReconciliationOptions?: TokenSetResumeReconciliationOptions;
}

export interface FrontendOidcModeBrowserClientMaterialization {
	client: FrontendOidcModeClient;
	config: FrontendOidcModeClientConfig;
	resolvedProjection: ResolvedConfigProjection;
	browserPersistentStorageKey: string;
}

/**
 * Materialize a browser-owned frontend OIDC client from a projection endpoint
 * plus browser runtime capabilities.
 */
export async function createFrontendOidcModeBrowserClient(
	options: CreateFrontendOidcModeBrowserClientOptions,
): Promise<FrontendOidcModeBrowserClientMaterialization> {
	const configEndpoint = new URL(
		options.configEndpoint,
		window.location.origin,
	);
	configEndpoint.searchParams.set("redirect_uri", options.redirectUri);
	const response = await fetch(configEndpoint.toString());
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

	const persistentStoragePrefix =
		options.persistentStoragePrefix ?? FRONTEND_OIDC_PERSISTENT_PREFIX;
	const sessionStoragePrefix =
		options.sessionStoragePrefix ?? FRONTEND_OIDC_SESSION_PREFIX;
	const runtime = createWebRuntime({
		transport: options.transport,
		fetchTransport: options.fetchTransport,
		scheduler: options.scheduler,
		clock: options.clock,
		logger: options.logger,
		traceSink: options.traceSink,
		persistentStore:
			options.persistentStore ??
			createLocalStorageStore(persistentStoragePrefix),
		sessionStore:
			options.sessionStore ?? createSessionStorageStore(sessionStoragePrefix),
	});
	const client = attachTokenSetResumeReconciliation(
		createFrontendOidcModeClient(parsed.value, runtime),
		{
			resumeReconciliation: options.resumeReconciliation,
			resumeReconciliationOptions: options.resumeReconciliationOptions,
		},
	);

	return {
		client,
		config: parsed.value,
		resolvedProjection,
		browserPersistentStorageKey: resolveFrontendOidcModeBrowserStorageKey(
			parsed.value,
			persistentStoragePrefix,
		),
	};
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
// Persisted source: read from abstract RecordStore
// ---------------------------------------------------------------------------

/**
 * Create a persisted config source that reads from an abstract RecordStore.
 *
 * The persisted source stores config projections as JSON envelopes
 * containing both the raw projection data and the authoritative `generatedAt`
 * timestamp from the backend.
 *
 * @param options.store - Abstract RecordStore (e.g. from `createLocalStorageStore`)
 * @param options.storageKey - Key within the store
 * @param options.redirectUri - OIDC callback redirect URI override
 * @param options.defaultPostAuthRedirectUri - App-level default redirect after auth
 */
export function persistedConfigSource(options: {
	store: RecordStore;
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
// Persist resolved config to abstract RecordStore
// ---------------------------------------------------------------------------

/**
 * Persist a resolved config projection to an abstract RecordStore.
 *
 * Stores the raw projection data and its authoritative `generatedAt` so that
 * `persistedConfigSource` can restore it on next boot and revalidation can
 * check freshness against the projection's own generation time.
 *
 * @param store - Abstract RecordStore to write to
 * @param storageKey - Key within the store
 * @param resolved - The resolved config projection (must include `rawProjection`)
 */
export async function persistConfigProjection(
	store: RecordStore,
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
	 * Abstract RecordStore to persist revalidated config to.
	 */
	store: RecordStore;
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
	 * If absent or if `Date.now() - generatedAt > maxAge`, revalidation fires.
	 */
	generatedAt?: number;
	/**
	 * Diagnostic logger.
	 */
	logger?: (level: "info" | "warn" | "error", message: string) => void;
}

/**
 * Schedule idle-time revalidation of a config projection.
 *
 * Only triggers a network fetch if the current projection is stale
 * (`generatedAt + maxAge < now`). Uses `requestIdleCallback` when available,
 * falling back to `setTimeout(..., 1000)`.
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
		store,
		storageKey,
		maxAge = 300_000,
		generatedAt,
		logger,
	} = options;

	// Skip if source is still fresh based on authoritative generation time
	if (generatedAt !== undefined && Date.now() - generatedAt <= maxAge) {
		logger?.(
			"info",
			`Config projection still fresh (generated ${Math.round((Date.now() - generatedAt) / 1000)}s ago, maxAge=${maxAge / 1000}s). Skipping idle revalidation.`,
		);
		return undefined;
	}

	const doRevalidate = async () => {
		try {
			const raw = await networkSource.fetch();
			// Extract generatedAt from the fresh projection for the envelope
			const freshGeneratedAt =
				extractGeneratedAtFromProjection(raw) ?? Date.now();
			const envelope: PersistedConfigEnvelope = {
				data: raw,
				generatedAt: freshGeneratedAt,
			};
			await store.set(storageKey, JSON.stringify(envelope));
			logger?.(
				"info",
				`Idle revalidation succeeded — persisted fresh config (generatedAt: ${freshGeneratedAt})`,
			);
		} catch (error) {
			logger?.(
				"warn",
				`Idle revalidation failed — retaining cached config: ${error instanceof Error ? error.message : String(error)}`,
			);
			// Silently retain existing cache
		}
	};

	// Schedule via requestIdleCallback or setTimeout fallback
	if (typeof globalThis.requestIdleCallback === "function") {
		const id = globalThis.requestIdleCallback(() => {
			void doRevalidate();
		});
		return () => globalThis.cancelIdleCallback(id);
	}
	const id = globalThis.setTimeout(() => {
		void doRevalidate();
	}, 1000);
	return () => globalThis.clearTimeout(id);
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
