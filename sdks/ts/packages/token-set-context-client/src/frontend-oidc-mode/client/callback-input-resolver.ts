import {
	ClientError,
	ClientErrorKind,
	UriReferenceString,
	UserRecovery,
} from "@securitydept/client";
import {
	type OidcModeCallbackInputPredicate,
	type OidcModeCallbackInputResolver,
} from "../../orchestration/client/types";
import {
	type FrontendOidcModeCallbackInput,
	takeFrontendOidcCallbackInputFromRouter,
} from "../contracts/callback";
import { FrontendOidcModeErrorCode } from "./error-codes";
import { type FrontendOidcModeRedirectUriCandidatesInput } from "./types";

const CALLBACK_ERROR_SOURCE = "frontend-oidc-mode";

export interface CreateDefaultFrontendOidcModeCallbackInputResolverOptions {
	readonly redirectUriCandidates: FrontendOidcModeRedirectUriCandidatesInput;
	readonly callbackInputPredicate?: OidcModeCallbackInputPredicate<FrontendOidcModeCallbackInput>;
}

export function createDefaultFrontendOidcModeCallbackInputResolver({
	redirectUriCandidates,
	callbackInputPredicate,
}: CreateDefaultFrontendOidcModeCallbackInputResolverOptions): OidcModeCallbackInputResolver<FrontendOidcModeCallbackInput> {
	const callbackPathnames = new Set(
		(Array.isArray(redirectUriCandidates)
			? redirectUriCandidates
			: [redirectUriCandidates]
		).map((candidate) => UriReferenceString.parse(candidate).pathname),
	);
	return async ({ environment, cancellationToken }) => {
		cancellationToken.throwIfCancellationRequested();
		const router = environment.router;
		if (!router) {
			return null;
		}
		let callbackClaimed = false;
		const takenCallbackInput = await takeFrontendOidcCallbackInputFromRouter(
			router,
			{
				condition: async ({ callbackInput, callbackUrl }) => {
					if (!callbackPathnames.has(callbackUrl.pathname)) {
						return false;
					}
					if (
						callbackInputPredicate &&
						!(await callbackInputPredicate({
							callbackInput,
							callbackUrl,
							environment,
							cancellationToken,
						}))
					) {
						cancellationToken.throwIfCancellationRequested();
						return false;
					}
					cancellationToken.throwIfCancellationRequested();
					callbackClaimed = true;
					return true;
				},
			},
		);
		cancellationToken.throwIfCancellationRequested();
		if (!takenCallbackInput) {
			if (!callbackClaimed) {
				return null;
			}
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: FrontendOidcModeErrorCode.CallbackInputNotFound,
				message: "The frontend OIDC callback input is no longer available.",
				source: CALLBACK_ERROR_SOURCE,
				recovery: UserRecovery.RestartFlow,
			});
		}
		return takenCallbackInput;
	};
}
