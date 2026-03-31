// Auth Material Controller — thin lifecycle control layer for protocol-agnostic
// token material management.
//
// This controller composes the four core orchestration primitives:
//   - in-memory auth state (snapshot read/write)
//   - authorization header projection (bearerHeader)
//   - persistence (restore / save / clear)
//   - authorized transport composition
//
// It does NOT handle:
//   - token acquisition (redirect, callback, metadata redemption)
//   - token-set sealed flow or any specific OIDC protocol
//   - refresh scheduling (that belongs to the token-set client layer)
//   - multi-provider orchestration, router, or chooser logic
//
// Adopter guidance:
//   - Use this controller when you have token material from any source
//     (standard OIDC exchange, backend-issued token, forwarded bearer, etc.)
//     and want a managed lifecycle without tying to a specific protocol client.
//   - If you need token-set sealed callback handling or automatic refresh
//     scheduling, use TokenSetContextClient instead.

import type { HttpTransport, RecordStore } from "@securitydept/client";
import { createAuthorizedTransport } from "./auth-transport";
import type { AuthStatePersistence } from "./persistence";
import { createAuthStatePersistence } from "./persistence";
import { bearerHeader, mergeTokenDelta } from "./token-ops";
import type { AuthDelta, AuthSnapshot, TokenSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Auth Material Controller types
// ---------------------------------------------------------------------------

/** The readable surface exposed by AuthMaterialController. */
export interface AuthMaterialState {
	/** Current in-memory snapshot, or null if unauthenticated. */
	readonly snapshot: AuthSnapshot | null;
	/** Current bearer authorization header value, or null if unauthenticated. */
	readonly authorizationHeader: string | null;
}

/** Options for createAuthMaterialController. */
export interface CreateAuthMaterialControllerOptions {
	/**
	 * Optional persistence store and key.
	 * When provided, the controller can restore from and save to a durable store.\
	 */
	persistence?: {
		store: RecordStore;
		key: string;
		now?: () => number;
	};
}

/**
 * Options for applyDelta.
 *
 * Controls how metadata is merged when applying a token material update.
 */
export interface ApplyDeltaOptions {
	/**
	 * If provided, replace the current metadata with this value.
	 * If omitted, the current snapshot metadata is preserved.
	 *
	 * When the update also carries a new source (e.g. after refresh), pass
	 * the new metadata here.
	 */
	metadata?: AuthSnapshot["metadata"];
}

/** The full lifecycle control surface of AuthMaterialController. */
export interface AuthMaterialController extends AuthMaterialState {
	/**
	 * Apply a new snapshot as the current auth state.
	 * If persistence is configured, also saves the snapshot.
	 *
	 * Use this when you have a complete new set of token material
	 * (e.g. from an initial OIDC exchange or a full token replacement).
	 */
	applySnapshot(snapshot: AuthSnapshot): Promise<void>;

	/**
	 * Apply an externally-driven token material update (renew/update).
	 *
	 * This is the primary entry point for protocol-agnostic token renewal:
	 * - Token fields in the delta override the current snapshot.
	 * - Token fields absent from the delta are preserved (e.g. refreshMaterial).
	 * - Metadata is replaced with options.metadata if provided, otherwise kept.
	 * - If persistence is configured, the merged snapshot is saved automatically.
	 *
	 * Throws if there is no current snapshot to merge into.
	 * Use applySnapshot for the initial token material application.
	 *
	 * Example use cases:
	 *   - Backend issues a new access token without replacing the refresh token
	 *   - OIDC token refresh returns only access_token + expires_at
	 *   - Forwarded bearer updates the access token but keeps the principal
	 *
	 * @param delta - the token fields to merge (accessToken is required)
	 * @param options.metadata - optional new metadata; current metadata preserved if omitted
	 */
	applyDelta(
		delta: AuthDelta["tokens"],
		options?: ApplyDeltaOptions,
	): Promise<AuthSnapshot>;

	/**
	 * Attempt to restore the most recent snapshot from the persistence store.
	 * Returns the snapshot if found and valid, null otherwise.
	 * If no persistence is configured, always returns null.
	 */
	restoreFromPersistence(): Promise<AuthSnapshot | null>;

	/**
	 * Clear the current in-memory state and, optionally, the persisted state.
	 * @param options.clearPersisted - defaults to true
	 */
	clearState(options?: { clearPersisted?: boolean }): Promise<void>;

	/**
	 * Synchronously set the in-memory snapshot without saving to persistence.
	 *
	 * Use this when the caller already manages the persistence save separately,
	 * or when only in-memory state needs to be aligned (e.g. after a manual
	 * in-process token injection or after an external restore).
	 *
	 * For the normal flow (apply + persist as a unit), use applySnapshot instead.
	 */
	injectSnapshot(snapshot: AuthSnapshot): void;

	/**
	 * Create an HttpTransport that injects the current bearer header on each request.
	 * @param baseTransport - the underlying transport to wrap
	 * @param options.requireAuthorization - if true (default), throws when no token is present
	 */
	createTransport(
		baseTransport: HttpTransport,
		options?: { requireAuthorization?: boolean },
	): HttpTransport;

	/**
	 * The persistence adapter, if configured. Exposed for adopters that need
	 * direct persistence access beyond the lifecycle methods above.
	 */
	readonly persistence: AuthStatePersistence | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a thin, protocol-agnostic auth material lifecycle controller.
 *
 * The controller manages one auth state slot (snapshot + bearer projection +
 * optional persistence). It is suitable for any token source: standard OIDC,
 * backend-issued tokens, forwarded bearer, etc.
 *
 * @example
 * ```ts
 * // Standard OIDC scenario — token received from OIDC exchange
 * const controller = createAuthMaterialController({
 *   persistence: { store, key: "auth:v1", now: Date.now }
 * });
 *
 * // After receiving tokens from your OIDC library:
 * await controller.applySnapshot({
 *   tokens: { accessToken: "at", refreshMaterial: "rt" },
 *   metadata: { source: { kind: AuthSourceKind.OidcAuthorizationCode } },
 * });
 *
 * const transport = controller.createTransport(baseHttpTransport);
 * ```
 */
export function createAuthMaterialController(
	options: CreateAuthMaterialControllerOptions = {},
): AuthMaterialController {
	let currentSnapshot: AuthSnapshot | null = null;

	const persistence: AuthStatePersistence | null = options.persistence
		? createAuthStatePersistence({
				store: options.persistence.store,
				key: options.persistence.key,
				now: options.persistence.now ?? Date.now,
			})
		: null;

	function currentTokens(): TokenSnapshot | null {
		return currentSnapshot?.tokens ?? null;
	}

	const controller: AuthMaterialController = {
		get snapshot(): AuthSnapshot | null {
			return currentSnapshot;
		},

		get authorizationHeader(): string | null {
			return bearerHeader(currentTokens());
		},

		get persistence(): AuthStatePersistence | null {
			return persistence;
		},

		async applySnapshot(snapshot: AuthSnapshot): Promise<void> {
			currentSnapshot = snapshot;
			if (persistence) {
				await persistence.save(snapshot);
			}
		},

		async applyDelta(
			delta: AuthDelta["tokens"],
			options: ApplyDeltaOptions = {},
		): Promise<AuthSnapshot> {
			if (!currentSnapshot) {
				throw new Error(
					"applyDelta requires an existing snapshot. " +
						"Call applySnapshot first to establish the initial token material.",
				);
			}
			// Merge token delta into current snapshot; preserve metadata unless caller
			// explicitly provides new metadata (e.g. after refresh with new source info).
			const merged: AuthSnapshot = {
				tokens: mergeTokenDelta(currentSnapshot.tokens, delta),
				metadata: options.metadata ?? currentSnapshot.metadata,
			};
			currentSnapshot = merged;
			if (persistence) {
				await persistence.save(merged);
			}
			return merged;
		},

		async restoreFromPersistence(): Promise<AuthSnapshot | null> {
			if (!persistence) {
				return null;
			}
			const restored = await persistence.load();
			if (restored) {
				currentSnapshot = restored;
			}
			return restored;
		},

		injectSnapshot(snapshot: AuthSnapshot): void {
			// Synchronous in-memory update only — no persistence save.
			// Used when the caller controls persistence externally, or for
			// manual/in-process state restoration without storage round-trip.
			currentSnapshot = snapshot;
		},

		async clearState(
			options: { clearPersisted?: boolean } = {},
		): Promise<void> {
			currentSnapshot = null;
			const clearPersisted = options.clearPersisted ?? true;
			if (clearPersisted && persistence) {
				await persistence.clear();
			}
		},

		createTransport(
			baseTransport: HttpTransport,
			transportOptions: { requireAuthorization?: boolean } = {},
		): HttpTransport {
			return createAuthorizedTransport(
				{ authorizationHeader: () => bearerHeader(currentTokens()) },
				{ transport: baseTransport, ...transportOptions },
			);
		},
	};

	return controller;
}
