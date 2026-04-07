// Session /me response schemas — @standard-schema aligned validation
//
// These schemas validate the two accepted shapes of the /me endpoint response:
//   1. Internal (camelCase): { principal: { displayName, picture?, claims? } }
//   2. Server (snake_case): { display_name, picture?, claims? }

import { createSchema } from "@securitydept/client";
import type { SessionInfo, SessionPrincipal } from "./types";

/**
 * Schema for the canonical SessionInfo shape (camelCase principal).
 *
 * This is the preferred shape once normalized.
 */
export const SessionInfoSchema = createSchema<SessionInfo>({
	validate(input: unknown) {
		if (
			typeof input === "object" &&
			input !== null &&
			"principal" in input &&
			typeof (input as Record<string, unknown>).principal === "object" &&
			(input as Record<string, unknown>).principal !== null
		) {
			const principal = (input as { principal: Record<string, unknown> })
				.principal;
			if (
				"displayName" in principal &&
				typeof principal.displayName === "string"
			) {
				const result: SessionInfo = {
					principal: {
						displayName: principal.displayName,
						picture:
							typeof principal.picture === "string"
								? principal.picture
								: undefined,
						claims:
							typeof principal.claims === "object" && principal.claims !== null
								? (principal.claims as Record<string, unknown>)
								: undefined,
					},
				};
				return { value: result };
			}
		}
		return {
			issues: [
				{
					message: "Expected SessionInfo with principal.displayName (string)",
					path: ["principal", "displayName"],
				},
			],
		};
	},
});

/**
 * Schema for the server-side UserInfo response shape (snake_case fields).
 *
 * For cross-boundary payloads from the Rust server which uses `display_name`.
 * Validates and normalizes into SessionInfo in one step.
 */
export const SessionUserInfoResponseSchema = createSchema<SessionInfo>({
	validate(input: unknown) {
		if (
			typeof input === "object" &&
			input !== null &&
			"display_name" in input &&
			typeof (input as Record<string, unknown>).display_name === "string"
		) {
			const raw = input as Record<string, unknown>;
			const principal: SessionPrincipal = {
				displayName: raw.display_name as string,
				picture: typeof raw.picture === "string" ? raw.picture : undefined,
				claims:
					typeof raw.claims === "object" && raw.claims !== null
						? (raw.claims as Record<string, unknown>)
						: undefined,
			};
			return { value: { principal } };
		}
		return {
			issues: [
				{
					message:
						"Expected server UserInfo response with display_name (string)",
					path: ["display_name"],
				},
			],
		};
	},
});
