import { UserRecovery } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { describeTokenSetCallbackError } from "../error-presentation";

describe("describeTokenSetCallbackError", () => {
	it("falls back to a shared token-set callback descriptor", () => {
		expect(
			describeTokenSetCallbackError({
				code: "callback.other",
				kind: "protocol",
				message: "Other callback failure",
				recovery: UserRecovery.None,
				retryable: false,
				source: "frontend-oidc-mode",
			}),
		).toMatchObject({
			code: "callback.other",
			title: "Authentication callback failed",
			description: "Other callback failure",
			recovery: UserRecovery.None,
			tone: "danger",
		});
	});
});
