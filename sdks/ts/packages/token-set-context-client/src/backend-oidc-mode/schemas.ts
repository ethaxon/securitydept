// Backend OIDC Mode — response body schemas
//
// Uses @standard-schema via the foundation createSchema helper to validate
// callback and refresh JSON response bodies at the cross-boundary entry point.

import { createSchema } from "@securitydept/client";
import type {
	BackendOidcModeCallbackReturns,
	BackendOidcModeRefreshReturns,
} from "./contracts";

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Check an optional string field. If the field is absent or undefined, return
 * undefined. If it is a string, return the string. If it is present but not a
 * string, push an issue.
 */
function checkOptionalString(
	value: unknown,
	fieldName: string,
	issues: Array<{ message: string }>,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	issues.push({
		message: `${fieldName}: expected a string if present, got ${typeof value}`,
	});
	return undefined;
}

/**
 * Schema for validating BackendOidcModeCallbackReturns from a raw JSON body.
 *
 * Validates:
 *   - `access_token` is a string (required)
 *   - `id_token` is a string (required)
 *   - optional fields have correct types when present (fail on wrong type)
 */
export const BackendOidcModeCallbackBodySchema =
	createSchema<BackendOidcModeCallbackReturns>({
		validate(input) {
			if (!isObject(input)) {
				return { issues: [{ message: "Expected an object" }] };
			}

			const issues: Array<{ message: string }> = [];

			if (typeof input.access_token !== "string") {
				issues.push({ message: "access_token: expected a string" });
			}
			if (typeof input.id_token !== "string") {
				issues.push({ message: "id_token: expected a string" });
			}

			const refreshToken = checkOptionalString(
				input.refresh_token,
				"refresh_token",
				issues,
			);
			const expiresAt = checkOptionalString(
				input.access_token_expires_at,
				"access_token_expires_at",
				issues,
			);
			const metadataRedemptionId = checkOptionalString(
				input.metadata_redemption_id,
				"metadata_redemption_id",
				issues,
			);

			if (issues.length > 0) {
				return { issues };
			}

			return {
				value: {
					accessToken: input.access_token as string,
					idToken: input.id_token as string,
					refreshToken,
					expiresAt,
					metadataRedemptionId,
				},
			};
		},
	});

/**
 * Schema for validating BackendOidcModeRefreshReturns from a raw JSON body.
 *
 * Validates:
 *   - `access_token` is a string (required)
 *   - optional fields have correct types when present (fail on wrong type)
 */
export const BackendOidcModeRefreshBodySchema =
	createSchema<BackendOidcModeRefreshReturns>({
		validate(input) {
			if (!isObject(input)) {
				return { issues: [{ message: "Expected an object" }] };
			}

			const issues: Array<{ message: string }> = [];

			if (typeof input.access_token !== "string") {
				issues.push({ message: "access_token: expected a string" });
			}

			const idToken = checkOptionalString(input.id_token, "id_token", issues);
			const refreshToken = checkOptionalString(
				input.refresh_token,
				"refresh_token",
				issues,
			);
			const expiresAt = checkOptionalString(
				input.access_token_expires_at,
				"access_token_expires_at",
				issues,
			);
			const metadataRedemptionId = checkOptionalString(
				input.metadata_redemption_id,
				"metadata_redemption_id",
				issues,
			);

			if (issues.length > 0) {
				return { issues };
			}

			return {
				value: {
					accessToken: input.access_token as string,
					idToken,
					refreshToken,
					expiresAt,
					metadataRedemptionId,
				},
			};
		},
	});
