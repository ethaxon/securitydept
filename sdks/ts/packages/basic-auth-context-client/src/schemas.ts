// basic-auth-context-client — config validation schema
//
// Uses @standard-schema via the foundation createSchema helper to validate
// BasicAuthContextClientConfig at the cross-boundary entry point.

import { createSchema } from "@securitydept/client";
import type { BasicAuthContextClientConfig } from "./types";

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.length > 0;
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateZoneConfig(input: unknown, index: number) {
	const issues: Array<{ message: string }> = [];
	if (!isObject(input)) {
		issues.push({ message: `zones[${index}]: expected an object` });
		return { issues };
	}
	if (!isNonEmptyString(input.zonePrefix)) {
		issues.push({
			message: `zones[${index}].zonePrefix: expected a non-empty string`,
		});
	}
	if (
		input.loginSubpath !== undefined &&
		typeof input.loginSubpath !== "string"
	) {
		issues.push({
			message: `zones[${index}].loginSubpath: expected a string if provided`,
		});
	}
	if (
		input.logoutSubpath !== undefined &&
		typeof input.logoutSubpath !== "string"
	) {
		issues.push({
			message: `zones[${index}].logoutSubpath: expected a string if provided`,
		});
	}
	return issues.length > 0 ? { issues } : null;
}

/**
 * Schema for validating BasicAuthContextClientConfig.
 *
 * Validates:
 *   - `baseUrl` is a non-empty string
 *   - `zones` is a non-empty array of valid zone configs
 *   - each zone has a non-empty `zonePrefix`
 *   - optional fields have correct types when provided
 */
export const BasicAuthContextClientConfigSchema =
	createSchema<BasicAuthContextClientConfig>({
		validate(input) {
			const issues: Array<{ message: string }> = [];

			if (!isObject(input)) {
				return { issues: [{ message: "Expected an object" }] };
			}

			if (!isNonEmptyString(input.baseUrl)) {
				issues.push({ message: "baseUrl: expected a non-empty string" });
			}

			if (!Array.isArray(input.zones) || input.zones.length === 0) {
				issues.push({
					message: "zones: expected a non-empty array of zone configs",
				});
			} else {
				for (let i = 0; i < input.zones.length; i++) {
					const zoneResult = validateZoneConfig(input.zones[i], i);
					if (zoneResult) {
						issues.push(...zoneResult.issues);
					}
				}
			}

			if (
				input.postAuthRedirectParam !== undefined &&
				typeof input.postAuthRedirectParam !== "string"
			) {
				issues.push({
					message: "postAuthRedirectParam: expected a string if provided",
				});
			}

			if (issues.length > 0) {
				return { issues };
			}

			return { value: input as unknown as BasicAuthContextClientConfig };
		},
	});
