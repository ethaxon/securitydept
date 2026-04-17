import { UserRecovery } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { FrontendOidcModeCallbackErrorCode } from "../callback-error-codes";
import { describeFrontendOidcModeCallbackError } from "../error-presentation";

function createCallbackError(code: string) {
	return {
		code,
		kind: "protocol",
		message: code,
		recovery: UserRecovery.RestartFlow,
		retryable: false,
		source: "frontend-oidc-mode",
	} as const;
}

describe("describeFrontendOidcModeCallbackError", () => {
	it("describes unknown-state callbacks with a restart action", () => {
		expect(
			describeFrontendOidcModeCallbackError(
				createCallbackError(FrontendOidcModeCallbackErrorCode.UnknownState),
				{
					recoveryLinks: {
						[UserRecovery.RestartFlow]: "/playground/token-set/frontend-mode",
					},
					recoveryLabels: {
						[UserRecovery.RestartFlow]: "Return to frontend-mode playground",
					},
				},
			),
		).toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.UnknownState,
			title: "Unknown callback state",
			recovery: UserRecovery.RestartFlow,
			primaryAction: {
				recovery: UserRecovery.RestartFlow,
				label: "Return to frontend-mode playground",
				href: "/playground/token-set/frontend-mode",
			},
		});
	});

	it("describes client-mismatch callbacks as a host-binding failure", () => {
		expect(
			describeFrontendOidcModeCallbackError(
				createCallbackError(
					FrontendOidcModeCallbackErrorCode.PendingClientMismatch,
				),
			),
		).toMatchObject({
			code: FrontendOidcModeCallbackErrorCode.PendingClientMismatch,
			title: "Callback belongs to another frontend-mode client",
			recovery: UserRecovery.RestartFlow,
			tone: "danger",
		});
	});

	it("falls back to the shared descriptor for unknown callback failures", () => {
		expect(
			describeFrontendOidcModeCallbackError({
				code: "callback.other",
				kind: "protocol",
				message: "Other callback failure",
				recovery: UserRecovery.None,
				retryable: false,
			}),
		).toMatchObject({
			code: "callback.other",
			title: "Frontend-mode callback failed",
			description: "Other callback failure",
			recovery: UserRecovery.None,
		});
	});
});
