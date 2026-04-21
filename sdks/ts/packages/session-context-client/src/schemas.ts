// Session /auth/session/user-info response schemas — shared principal validation
//
// These schemas validate the two accepted shapes of the session user-info
// response:
//   1. Internal (camelCase):
//      { principal: { subject, displayName, picture?, issuer?, claims? } }
//   2. Rust server wire (snake_case):
//      { subject, display_name, picture?, issuer?, claims? }

import {
	createSchema,
	normalizeAuthenticatedPrincipal,
	normalizeAuthenticatedPrincipalWire,
} from "@securitydept/client";
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
			const principal = normalizeAuthenticatedPrincipal(
				(input as { principal: Record<string, unknown> }).principal,
			);
			if (principal) {
				return { value: { principal } };
			}
		}
		return {
			issues: [
				{
					message:
						"Expected SessionInfo with principal.subject and principal.displayName",
					path: ["principal", "subject"],
				},
			],
		};
	},
});

/**
 * Schema for the Rust server session user-info response shape.
 *
 * Validates the real `/auth/session/user-info` wire payload and normalizes it
 * into SessionInfo in one step.
 */
export const SessionUserInfoResponseSchema = createSchema<SessionInfo>({
	validate(input: unknown) {
		if (
			typeof input === "object" &&
			input !== null &&
			"subject" in input &&
			typeof (input as Record<string, unknown>).subject === "string"
		) {
			const raw = input as Record<string, unknown>;
			const principal = normalizeAuthenticatedPrincipalWire(raw);
			if (principal) {
				return { value: { principal: principal as SessionPrincipal } };
			}
		}
		return {
			issues: [
				{
					message: "Expected server UserInfo response with subject (string)",
					path: ["subject"],
				},
			],
		};
	},
});
