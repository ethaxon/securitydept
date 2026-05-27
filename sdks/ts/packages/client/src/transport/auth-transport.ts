import { ClientError } from "../errors/client-error";
import { ClientErrorKind, UserRecovery } from "../errors/types";
import { type ReadableReplaySignalTrait } from "../signals/types";
import {
	type BaseTransportTrait,
	type HttpRequest,
	type ManagedTransportTrait,
} from "./types";

const AUTH_TRANSPORT_SOURCE = "client-transport";

export interface BearerHeaderProvider {
	authorizationHeader(): string | null;
}

export interface ReplayBearerHeaderProvider {
	authorizationHeaderValue: ReadableReplaySignalTrait<string | undefined>;
}

export type AuthorizationHeaderProviderTrait =
	| BearerHeaderProvider
	| ReplayBearerHeaderProvider;

export interface CreateAuthorizedTransportOptions {
	baseTransport: BaseTransportTrait;
	requireAuthorization?: boolean;
	clientKey?: string;
	id?: string;
}

export interface CreateRemappingAuthorizedTransportOptions
	extends CreateAuthorizedTransportOptions {
	remapError: (cause: unknown) => unknown;
}

export function createAuthorizedTransportFromBase(
	headerProvider: AuthorizationHeaderProviderTrait,
	options: CreateAuthorizedTransportOptions,
): ManagedTransportTrait {
	const requireAuthorization = options.requireAuthorization ?? true;

	return {
		async execute(request: HttpRequest) {
			const authorization = await resolveAuthorizationHeader(headerProvider);
			if (!authorization) {
				if (!requireAuthorization) {
					return options.baseTransport.execute(request);
				}
				throw new ClientError({
					kind: ClientErrorKind.Unauthenticated,
					message: "Authorization header is unavailable",
					code: "client.authorization.unavailable",
					recovery: UserRecovery.Reauthenticate,
					source: AUTH_TRANSPORT_SOURCE,
				});
			}

			return options.baseTransport.execute({
				...request,
				headers: {
					...request.headers,
					authorization,
				},
			});
		},
	};
}

export function createRemappingAuthorizedTransportFromBase(
	headerProvider: AuthorizationHeaderProviderTrait,
	options: CreateRemappingAuthorizedTransportOptions,
): ManagedTransportTrait {
	const base = createAuthorizedTransportFromBase(headerProvider, options);

	return {
		async execute(request: HttpRequest) {
			try {
				return await base.execute(request);
			} catch (cause) {
				throw options.remapError(cause);
			}
		},
	};
}

function resolveAuthorizationHeader(
	headerProvider: AuthorizationHeaderProviderTrait,
): Promise<string | null> | string | null {
	if ("authorizationHeaderValue" in headerProvider) {
		return headerProvider.authorizationHeaderValue
			.whenValue()
			.then((header) => header ?? null);
	}
	return headerProvider.authorizationHeader();
}
