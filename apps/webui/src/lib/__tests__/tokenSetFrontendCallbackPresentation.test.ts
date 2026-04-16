import { UserRecovery } from "@securitydept/client";
import { FrontendOidcModeCallbackErrorCode } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import type { CallbackResumeErrorDetails } from "@securitydept/token-set-context-client-react";
import { describe, expect, it } from "vitest";
import { describeFrontendModeCallbackFailure } from "@/lib/tokenSetFrontendCallbackPresentation";

function createErrorDetails(
	code: string,
	overrides: Partial<CallbackResumeErrorDetails> = {},
): CallbackResumeErrorDetails {
	return {
		code,
		kind: "protocol",
		message: code,
		recovery: UserRecovery.RestartFlow,
		retryable: false,
		source: "frontend-oidc-mode",
		cause: new Error(code),
		...overrides,
	};
}

describe("describeFrontendModeCallbackFailure()", () => {
	it("describes unknown-state callbacks with a restart action", () => {
		expect(
			describeFrontendModeCallbackFailure(
				createErrorDetails(FrontendOidcModeCallbackErrorCode.UnknownState),
			),
		).toEqual({
			title: "Unknown callback state",
			description:
				"This callback does not match any pending frontend-mode login in the current browser session. Start the frontend-mode login again from the reference playground.",
			actionLabel: "Return to frontend-mode playground",
			actionHref: "/playground/token-set/frontend-mode",
			tone: "warning",
		});
	});

	it("describes stale callbacks with a restart action", () => {
		expect(
			describeFrontendModeCallbackFailure(
				createErrorDetails(FrontendOidcModeCallbackErrorCode.PendingStale),
			),
		).toEqual({
			title: "Callback state expired",
			description:
				"The browser had a pending frontend-mode login for this callback, but the saved state expired before the callback was resumed. Start the login flow again.",
			actionLabel: "Return to frontend-mode playground",
			actionHref: "/playground/token-set/frontend-mode",
			tone: "warning",
		});
	});

	it("describes client-mismatch callbacks as a host-binding failure", () => {
		expect(
			describeFrontendModeCallbackFailure(
				createErrorDetails(
					FrontendOidcModeCallbackErrorCode.PendingClientMismatch,
				),
			),
		).toEqual({
			title: "Callback belongs to another frontend-mode client",
			description:
				"This callback was created for a different frontend-mode client or redirect binding than the one registered by the reference app. Restart the frontend-mode login from this app.",
			actionLabel: "Return to frontend-mode playground",
			actionHref: "/playground/token-set/frontend-mode",
			tone: "danger",
		});
	});

	it("falls back to the structured SDK message for unknown callback errors", () => {
		expect(
			describeFrontendModeCallbackFailure(
				createErrorDetails("callback.other", {
					message: "Other callback failure",
					recovery: UserRecovery.None,
				}),
			),
		).toEqual({
			title: "Frontend-mode callback failed",
			description: "Other callback failure",
			actionLabel: null,
			actionHref: null,
			tone: "danger",
		});
	});
});
