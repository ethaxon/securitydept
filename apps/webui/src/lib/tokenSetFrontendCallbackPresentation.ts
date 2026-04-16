import { UserRecovery } from "@securitydept/client";
import { FrontendOidcModeCallbackErrorCode } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import type { CallbackResumeErrorDetails } from "@securitydept/token-set-context-client-react";
import { TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH } from "@/lib/tokenSetConfig";

export interface FrontendModeCallbackFailurePresentation {
	title: string;
	description: string;
	actionLabel: string | null;
	actionHref: string | null;
	tone: "warning" | "danger";
}

function createRestartFlowAction() {
	return {
		actionLabel: "Return to frontend-mode playground",
		actionHref: TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
	};
}

export function describeFrontendModeCallbackFailure(
	errorDetails: CallbackResumeErrorDetails,
): FrontendModeCallbackFailurePresentation {
	switch (errorDetails.code) {
		case FrontendOidcModeCallbackErrorCode.UnknownState:
			return {
				title: "Unknown callback state",
				description:
					"This callback does not match any pending frontend-mode login in the current browser session. Start the frontend-mode login again from the reference playground.",
				...createRestartFlowAction(),
				tone: "warning",
			};
		case FrontendOidcModeCallbackErrorCode.PendingStale:
			return {
				title: "Callback state expired",
				description:
					"The browser had a pending frontend-mode login for this callback, but the saved state expired before the callback was resumed. Start the login flow again.",
				...createRestartFlowAction(),
				tone: "warning",
			};
		case FrontendOidcModeCallbackErrorCode.PendingClientMismatch:
			return {
				title: "Callback belongs to another frontend-mode client",
				description:
					"This callback was created for a different frontend-mode client or redirect binding than the one registered by the reference app. Restart the frontend-mode login from this app.",
				...createRestartFlowAction(),
				tone: "danger",
			};
		case FrontendOidcModeCallbackErrorCode.DuplicateState:
			return {
				title: "Callback already consumed",
				description:
					"This callback URL has already been completed once and cannot be replayed. Start a new frontend-mode login if you need another session.",
				...createRestartFlowAction(),
				tone: "warning",
			};
		default:
			return {
				title: "Frontend-mode callback failed",
				description:
					errorDetails.message ||
					"The React SDK callback route could not complete the frontend-mode login flow.",
				actionLabel:
					errorDetails.recovery === UserRecovery.RestartFlow
						? "Return to frontend-mode playground"
						: null,
				actionHref:
					errorDetails.recovery === UserRecovery.RestartFlow
						? TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH
						: null,
				tone: "danger",
			};
	}
}
