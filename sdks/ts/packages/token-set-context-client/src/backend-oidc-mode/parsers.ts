import { validateWithSchemaSync } from "@securitydept/client";
import type {
	BackendOidcModeCallbackReturns,
	BackendOidcModeRefreshReturns,
} from "./contracts";
import {
	BackendOidcModeCallbackBodySchema,
	BackendOidcModeRefreshBodySchema,
} from "./schemas";

// ---------------------------------------------------------------------------
// Callback response body parser
// ---------------------------------------------------------------------------

/**
 * Parse a callback redirect fragment (or JSON response body fields) into a
 * typed callback response body.
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
): BackendOidcModeCallbackReturns | null {
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
// Refresh response body parser
// ---------------------------------------------------------------------------

/**
 * Parse a refresh redirect fragment (or JSON response body fields) into a
 * typed refresh response body.
 *
 * Returns `null` if the required `access_token` field is missing.
 */
export function parseBackendOidcModeRefreshFragment(
	fragment: string,
): BackendOidcModeRefreshReturns | null {
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
// JSON body parsers (200 OK response body from *_body_return endpoints)
//
// These use @standard-schema via BackendOidcModeCallbackBodySchema and
// BackendOidcModeRefreshBodySchema for cross-boundary validation.
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON object (from a 200 OK `callback_body_return` response)
 * into a typed callback returns value.
 *
 * Returns `null` if schema validation fails (required fields missing or
 * wrong types).
 */
export function parseBackendOidcModeCallbackBody(
	body: Record<string, unknown>,
): BackendOidcModeCallbackReturns | null {
	const result = validateWithSchemaSync(
		BackendOidcModeCallbackBodySchema,
		body,
	);
	if (!result.success) return null;
	return result.value;
}

/**
 * Parse a raw JSON object (from a 200 OK `refresh_body_return` response)
 * into a typed refresh returns value.
 *
 * Returns `null` if schema validation fails (required fields missing or
 * wrong types).
 */
export function parseBackendOidcModeRefreshBody(
	body: Record<string, unknown>,
): BackendOidcModeRefreshReturns | null {
	const result = validateWithSchemaSync(BackendOidcModeRefreshBodySchema, body);
	if (!result.success) return null;
	return result.value;
}

// ---------------------------------------------------------------------------
// Orchestration adapters
// ---------------------------------------------------------------------------

/**
 * Convert a callback response body into an orchestration `TokenSnapshot`.
 */
export function callbackReturnsToTokenSnapshot(
	body: BackendOidcModeCallbackReturns,
): import("../orchestration/types").TokenSnapshot {
	return {
		accessToken: body.accessToken,
		idToken: body.idToken,
		refreshMaterial: body.refreshToken,
		accessTokenExpiresAt: body.expiresAt,
	};
}

/**
 * Convert a refresh response body into an orchestration `TokenDelta`.
 */
export function refreshReturnsToTokenDelta(
	body: BackendOidcModeRefreshReturns,
): import("../orchestration/types").TokenDelta {
	return {
		accessToken: body.accessToken,
		idToken: body.idToken,
		refreshMaterial: body.refreshToken,
		accessTokenExpiresAt: body.expiresAt,
	};
}
