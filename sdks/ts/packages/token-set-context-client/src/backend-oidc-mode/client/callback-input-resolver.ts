import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";
import {
	type OidcModeCallbackInputPredicate,
	type OidcModeCallbackInputResolver,
} from "../../orchestration/client/types";
import {
	type BackendOidcModeCallbackInput,
	takeBackendOidcCallbackInputFromRouter,
} from "../contracts/callback";
import {
	BackendOidcModeErrorCode,
	BackendOidcModeErrorSource,
} from "./error-codes";

export interface CreateDefaultBackendOidcModeCallbackInputResolverOptions {
	readonly callbackRoutingKey?: string;
	readonly callbackInputPredicate?: OidcModeCallbackInputPredicate<BackendOidcModeCallbackInput>;
}

export function createDefaultBackendOidcModeCallbackInputResolver({
	callbackRoutingKey,
	callbackInputPredicate,
}: CreateDefaultBackendOidcModeCallbackInputResolverOptions = {}): OidcModeCallbackInputResolver<BackendOidcModeCallbackInput> {
	return async ({ environment, cancellationToken }) => {
		cancellationToken.throwIfCancellationRequested();
		const router = environment.router;
		if (!router) {
			return null;
		}

		let callbackClaimed = false;
		const callbackInput = await takeBackendOidcCallbackInputFromRouter(router, {
			condition: async ({
				callbackInput,
				callbackUrl,
				callbackRoutingKey: actualRoutingKey,
			}) => {
				if (actualRoutingKey !== callbackRoutingKey) {
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
		});
		cancellationToken.throwIfCancellationRequested();
		if (!callbackInput) {
			if (!callbackClaimed) {
				return null;
			}
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: BackendOidcModeErrorCode.CallbackInputNotFound,
				message: "The backend OIDC callback input is no longer available.",
				source: BackendOidcModeErrorSource.Client,
				recovery: UserRecovery.RestartFlow,
			});
		}
		return callbackInput;
	};
}
