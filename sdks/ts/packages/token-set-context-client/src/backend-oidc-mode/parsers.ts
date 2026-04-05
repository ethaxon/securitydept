// Backend OIDC Mode — unified fragment parsers
//
// Single implementation that works for both pure and mediated presets.
// The parser extracts all possible fields; the consumer checks for
// `metadataRedemptionId` presence based on their preset.

import type {
	BackendOidcModeCallbackFragment,
	BackendOidcModeRefreshFragment,
} from "./contracts";

// ---------------------------------------------------------------------------
// Callback fragment parser
// ---------------------------------------------------------------------------

/**
 * Parse a callback redirect fragment into a typed callback fragment.
 *
 * Returns `null` if the required `access_token` or `id_token` fields
 * are missing.
 *
 * When `metadataDelivery = redemption`, the fragment will contain
 * `metadata_redemption_id`; when `metadataDelivery = none` it will not.
 * Both cases are handled uniformly.
 */
export function parseBackendOidcModeCallbackFragment(
	fragment: string,
): BackendOidcModeCallbackFragment | null {
	const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	const params = new URLSearchParams(raw);

	const accessToken = params.get("access_token");
	const idToken = params.get("id_token");
	if (!accessToken || !idToken) return null;

	return {
		accessToken,
		idToken,
		refreshToken: params.get("refresh_token") ?? undefined,
		expiresAt: params.get("expires_at") ?? undefined,
		metadataRedemptionId: params.get("metadata_redemption_id") ?? undefined,
	};
}

// ---------------------------------------------------------------------------
// Refresh fragment parser
// ---------------------------------------------------------------------------

/**
 * Parse a refresh redirect fragment into a typed refresh fragment.
 *
 * Returns `null` if the required `access_token` field is missing.
 */
export function parseBackendOidcModeRefreshFragment(
	fragment: string,
): BackendOidcModeRefreshFragment | null {
	const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	const params = new URLSearchParams(raw);

	const accessToken = params.get("access_token");
	if (!accessToken) return null;

	return {
		accessToken,
		idToken: params.get("id_token") ?? undefined,
		refreshToken: params.get("refresh_token") ?? undefined,
		expiresAt: params.get("expires_at") ?? undefined,
		metadataRedemptionId: params.get("metadata_redemption_id") ?? undefined,
	};
}

// ---------------------------------------------------------------------------
// Orchestration adapters
// ---------------------------------------------------------------------------

/**
 * Convert a callback fragment into an orchestration `TokenSnapshot`.
 */
export function callbackFragmentToTokenSnapshot(
	fragment: BackendOidcModeCallbackFragment,
): import("../orchestration/types").TokenSnapshot {
	return {
		accessToken: fragment.accessToken,
		idToken: fragment.idToken,
		refreshMaterial: fragment.refreshToken,
		accessTokenExpiresAt: fragment.expiresAt,
	};
}

/**
 * Convert a refresh fragment into an orchestration `TokenDelta`.
 */
export function refreshFragmentToTokenDelta(
	fragment: BackendOidcModeRefreshFragment,
): import("../orchestration/types").TokenDelta {
	return {
		accessToken: fragment.accessToken,
		idToken: fragment.idToken,
		refreshMaterial: fragment.refreshToken,
		accessTokenExpiresAt: fragment.expiresAt,
	};
}
