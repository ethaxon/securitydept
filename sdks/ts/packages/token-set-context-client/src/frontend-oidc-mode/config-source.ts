// Frontend OIDC Mode — config projection source contract (core)
//
// Defines how a frontend-oidc-mode client acquires its configuration
// projection before materialization. This is a core/shared contract
// consumed by both Angular and React adapters, and by runtime-specific
// helpers in sibling modules (e.g. config-source-web.ts).
//
// Design principles:
//   - Source resolution is async and framework-agnostic
//   - Multiple sources can compose with explicit precedence
//   - Readiness state is a first-class concept
//   - The contract owns the "config not yet available" lifecycle gap
//   - NO browser/web runtime assumptions — all host-specific capabilities
//     (fetch, globalThis, idle scheduling) live in runtime helper modules
//
// Stability: provisional (mode-aligned surface)

import { parseConfigProjection } from "./contracts";
import type { FrontendOidcModeClientConfig } from "./types";

// ---------------------------------------------------------------------------
// Config projection source identity
// ---------------------------------------------------------------------------

/**
 * Discriminated source identity for a resolved config projection.
 *
 * Tracks where the projection came from so higher layers (caching,
 * revalidation, telemetry) can make informed decisions.
 */
export const ConfigProjectionSourceKind = {
	/** Projection was provided inline at registration time (static config). */
	Inline: "inline",
	/** Projection was fetched from a network endpoint (backend /api/auth/config). */
	Network: "network",
	/** Projection was restored from a persistent cache (localStorage, etc.). */
	Persisted: "persisted",
	/** Projection was injected via a bootstrap script (<script> tag / window.__BOOTSTRAP__). */
	BootstrapScript: "bootstrap_script",
} as const;

export type ConfigProjectionSourceKind =
	(typeof ConfigProjectionSourceKind)[keyof typeof ConfigProjectionSourceKind];

// ---------------------------------------------------------------------------
// Resolved config projection result
// ---------------------------------------------------------------------------

/**
 * A resolved config projection paired with its source identity.
 */
export interface ResolvedConfigProjection {
	/** The resolved client config, ready for `createFrontendOidcModeClient`. */
	config: FrontendOidcModeClientConfig;
	/** Where this projection came from. */
	sourceKind: ConfigProjectionSourceKind;
	/**
	 * Authoritative freshness timestamp — the `generatedAt` epoch-ms from
	 * the backend config projection.
	 *
	 * This is the moment the backend assembled the projection, NOT the
	 * time it was injected, cached, or restored. All revalidation decisions
	 * should be based on this value.
	 *
	 * `undefined` when the projection lacks a `generatedAt` field (e.g.
	 * inline source or legacy payloads).
	 */
	generatedAt?: number;
	/**
	 * The raw (pre-parse) projection payload, suitable for persisting
	 * via a runtime-specific writeback helper.
	 */
	rawProjection?: unknown;
}

// ---------------------------------------------------------------------------
// Persisted config envelope
// ---------------------------------------------------------------------------

/**
 * Envelope stored in a `RecordStore` for persisted config projections.
 *
 * Used by persistence runtime helpers to serialize/deserialize projections
 * through generic key-value stores.
 */
export interface PersistedConfigEnvelope {
	/** The raw projection data (JSON-serializable). */
	data: unknown;
	/**
	 * Authoritative freshness timestamp — carried forward from the projection's
	 * `generatedAt`. NOT the time of local cache write.
	 */
	generatedAt: number;
}

// ---------------------------------------------------------------------------
// Config projection source descriptor
// ---------------------------------------------------------------------------

/**
 * A typed source descriptor for config projection resolution.
 *
 * Each variant represents a different acquisition strategy. The resolver
 * tries sources in precedence order and returns the first successful result.
 */
export type ConfigProjectionSource =
	| ConfigProjectionSourceInline
	| ConfigProjectionSourceNetwork
	| ConfigProjectionSourcePersisted
	| ConfigProjectionSourceBootstrapScript;

/** Static inline config — already resolved, no async work needed. */
export interface ConfigProjectionSourceInline {
	readonly kind: typeof ConfigProjectionSourceKind.Inline;
	/** Pre-resolved client config. */
	readonly config: FrontendOidcModeClientConfig;
}

/** Network source — fetches projection from a backend endpoint. */
export interface ConfigProjectionSourceNetwork {
	readonly kind: typeof ConfigProjectionSourceKind.Network;
	/**
	 * Async function that fetches the raw projection from the backend.
	 * Must return the parsed JSON body (not the HTTP response).
	 * Validation is handled by the resolver via `parseConfigProjection`.
	 */
	readonly fetch: () => Promise<unknown>;
	/**
	 * Overrides applied after parsing (e.g. `redirectUri`, `defaultPostAuthRedirectUri`).
	 */
	readonly overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>;
}

/** Persisted source — restores a previously cached projection. */
export interface ConfigProjectionSourcePersisted {
	readonly kind: typeof ConfigProjectionSourceKind.Persisted;
	/**
	 * Async function that reads a cached projection from persistent storage.
	 * Returns `null` if nothing is cached.
	 */
	readonly restore: () => Promise<unknown | null>;
	/**
	 * Overrides applied after parsing.
	 */
	readonly overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>;
}

/** Bootstrap script source — reads projection from host-injected globals. */
export interface ConfigProjectionSourceBootstrapScript {
	readonly kind: typeof ConfigProjectionSourceKind.BootstrapScript;
	/**
	 * Sync function that reads the projection from a host-injected source
	 * (e.g. a window global). Returns `null` if not present.
	 */
	readonly read: () => unknown | null;
	/**
	 * Overrides applied after parsing.
	 */
	readonly overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>;
}

// ---------------------------------------------------------------------------
// Client readiness state
// ---------------------------------------------------------------------------

/**
 * Readiness state for a client whose config is resolved asynchronously.
 *
 * This is used by adapters (Angular, React) to express whether the client
 * has materialized and is ready for use by guards, interceptors, and
 * callback handlers.
 */
export const ClientReadinessState = {
	/** Client registration is declared but config has not been resolved. */
	NotInitialized: "not_initialized",
	/** Config source resolution is in progress. */
	Initializing: "initializing",
	/** Config resolved and client materialized — ready for use. */
	Ready: "ready",
	/** Config resolution failed. */
	Failed: "failed",
} as const;

export type ClientReadinessState =
	(typeof ClientReadinessState)[keyof typeof ClientReadinessState];

// ---------------------------------------------------------------------------
// Config projection source resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a config projection from an ordered list of sources.
 *
 * Sources are tried in declaration order. The first source that produces
 * a valid `FrontendOidcModeClientConfig` wins. Sources that throw or
 * return `null` are skipped with a warning.
 *
 * This is the canonical resolution entry point for the config projection
 * source contract. Both Angular and React adapters should delegate to
 * this function instead of implementing their own resolution logic.
 *
 * @param sources - Ordered list of config projection sources (highest priority first).
 * @param logger - Optional logging callback for diagnostics.
 * @returns The resolved config projection with source identity, or throws
 *          if no source succeeds.
 *
 * @example
 * ```ts
 * const resolved = await resolveConfigProjection([
 *   { kind: "bootstrap_script", read: () => window.__OIDC_CONFIG__ },
 *   { kind: "network", fetch: () => fetch("/api/auth/config?...").then(r => r.json()) },
 * ]);
 * const client = createFrontendOidcModeClient(resolved.config, runtime);
 * ```
 */
export async function resolveConfigProjection(
	sources: readonly ConfigProjectionSource[],
	logger?: (level: "info" | "warn" | "error", message: string) => void,
): Promise<ResolvedConfigProjection> {
	for (const source of sources) {
		try {
			const result = await resolveOneSource(source);
			if (result !== null) {
				logger?.(
					"info",
					`Config projection resolved from source: ${source.kind}`,
				);
				return result;
			}
			logger?.(
				"info",
				`Config projection source "${source.kind}" returned null, trying next`,
			);
		} catch (error) {
			logger?.(
				"warn",
				`Config projection source "${source.kind}" failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			// Continue to next source
		}
	}

	throw new Error(
		`[frontend-oidc-mode] All config projection sources exhausted without success. ` +
			`Tried: ${sources.map((s) => s.kind).join(", ")}`,
	);
}

// ---------------------------------------------------------------------------
// Internal: single-source resolution
// ---------------------------------------------------------------------------

async function resolveOneSource(
	source: ConfigProjectionSource,
): Promise<ResolvedConfigProjection | null> {
	switch (source.kind) {
		case ConfigProjectionSourceKind.Inline:
			return {
				config: source.config,
				sourceKind: source.kind,
			};

		case ConfigProjectionSourceKind.Network: {
			const raw = await source.fetch();
			const result = parseAndWrap(raw, source.kind, source.overrides);
			return {
				...result,
				generatedAt: extractGeneratedAt(raw),
				rawProjection: raw,
			};
		}

		case ConfigProjectionSourceKind.Persisted: {
			const raw = await source.restore();
			if (raw === null || raw === undefined) return null;
			const unwrapped = unwrapEnvelope(raw);
			const result = parseAndWrap(
				unwrapped.data,
				source.kind,
				source.overrides,
			);
			return {
				...result,
				generatedAt:
					unwrapped.generatedAt ?? extractGeneratedAt(unwrapped.data),
				rawProjection: unwrapped.data,
			};
		}

		case ConfigProjectionSourceKind.BootstrapScript: {
			const raw = source.read();
			if (raw === null || raw === undefined) return null;
			const unwrapped = unwrapEnvelope(raw);
			const result = parseAndWrap(
				unwrapped.data,
				source.kind,
				source.overrides,
			);
			return {
				...result,
				generatedAt:
					unwrapped.generatedAt ?? extractGeneratedAt(unwrapped.data),
				rawProjection: unwrapped.data,
			};
		}

		default:
			return null;
	}
}

/**
 * Extract the authoritative `generatedAt` timestamp from a raw projection
 * payload. Returns `undefined` for legacy payloads without the field.
 */
function extractGeneratedAt(raw: unknown): number | undefined {
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

/**
 * Unwrap an envelope from runtime helpers (bootstrapScriptSource /
 * persistedConfigSource). They wrap data as `{ __data, __generatedAt }`
 * to carry the authoritative freshness timestamp through the generic
 * source interface.
 */
function unwrapEnvelope(raw: unknown): {
	data: unknown;
	generatedAt?: number;
} {
	if (typeof raw === "object" && raw !== null && "__data" in raw) {
		const envelope = raw as { __data: unknown; __generatedAt?: number };
		return {
			data: envelope.__data,
			generatedAt:
				typeof envelope.__generatedAt === "number"
					? envelope.__generatedAt
					: undefined,
		};
	}
	return { data: raw };
}

function parseAndWrap(
	raw: unknown,
	sourceKind: ConfigProjectionSourceKind,
	overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>,
): ResolvedConfigProjection {
	const result = parseConfigProjection(raw, overrides);
	if (!result.success) {
		const summary = result.issues
			.map((i) => `${(i.path ?? []).join(".")}: ${i.message}`)
			.join("; ");
		throw new Error(`Invalid config projection from ${sourceKind}: ${summary}`);
	}
	return { config: result.value, sourceKind };
}
