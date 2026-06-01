import {
	type CompatFragmentParameters,
	type HttpResponseJsonBody,
	IdentityPrincipalWireSchema,
	validateWithSchemaSync,
} from "@securitydept/client";
import { type TokenDelta, type TokenSnapshot } from "../../orchestration";
import {
	type BackendOidcModeCallbackReturns,
	type BackendOidcModeRefreshReturns,
	type BackendOidcModeUserInfoResponse,
} from "./contracts";
import {
	BackendOidcModeCallbackBodySchema,
	BackendOidcModeRefreshBodySchema,
} from "./schemas";

// ---------------------------------------------------------------------------
// Response payload parsers
// ---------------------------------------------------------------------------

/**
 * Parse a raw callback payload (compat fragment parameters or JSON body)
 * into a typed callback returns value.
 *
 * Returns `null` if schema validation fails (required fields missing or
 * wrong types).
 */
export function parseBackendOidcModeCallbackPayload(
	payload: CompatFragmentParameters | HttpResponseJsonBody,
): BackendOidcModeCallbackReturns | null {
	const result = validateWithSchemaSync(
		BackendOidcModeCallbackBodySchema,
		payload,
	);
	if (!result.success) {
		return null;
	}
	return result.value;
}

/**
 * Parse a raw refresh payload (compat fragment parameters or JSON body)
 * into a typed refresh returns value.
 *
 * Returns `null` if schema validation fails (required fields missing or
 * wrong types).
 */
export function parseBackendOidcModeRefreshPayload(
	payload: HttpResponseJsonBody,
): BackendOidcModeRefreshReturns | null {
	const result = validateWithSchemaSync(
		BackendOidcModeRefreshBodySchema,
		payload,
	);
	if (!result.success) {
		return null;
	}
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
): TokenSnapshot {
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
): TokenDelta {
	return {
		accessToken: body.accessToken,
		idToken: body.idToken,
		refreshMaterial: body.refreshToken,
		accessTokenExpiresAt: body.expiresAt,
	};
}

// ---------------------------------------------------------------------------
// User info response parser
// ---------------------------------------------------------------------------

/**
 * Parse a raw JSON object (from a 200 OK `/user-info` response) into a
 * typed user info response.
 *
 * Maps snake_case wire format (`display_name`) to camelCase TS
 * (`displayName`), consistent with all other transport parsers.
 *
 * Returns `null` if the required `subject` field is missing.
 */
export function parseBackendOidcModeUserInfoBody(
	body: Record<string, unknown>,
): BackendOidcModeUserInfoResponse | null {
	const result = validateWithSchemaSync(IdentityPrincipalWireSchema, body);
	return result.success ? result.value : null;
}
