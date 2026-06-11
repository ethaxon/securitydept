import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";

export const TokenSetClientRegistryErrorCode = {
	ClientUnregistered: "token_set.registry.client_unregistered",
	ClientRegistered: "token_set.registry.client_registered",
	ClientFactoryFailed: "token_set.registry.client_factory_failed",
} as const;

export const TokenSetClientRegistryErrorSource = "token_set.registry";

export type TokenSetClientRegistryErrorCode =
	(typeof TokenSetClientRegistryErrorCode)[keyof typeof TokenSetClientRegistryErrorCode];

export class TokenSetClientRegistryError extends ClientError {
	override readonly code: TokenSetClientRegistryErrorCode;
	readonly clientKey: string | null;

	constructor(options: {
		code: TokenSetClientRegistryErrorCode;
		clientKey?: string;
		message?: string;
		cause?: unknown;
	}) {
		super({
			kind: TokenSetClientRegistryError.kindForCode(options.code),
			code: options.code,
			message:
				options.message ??
				TokenSetClientRegistryError.defaultErrorMessage({
					code: options.code,
					clientKey: options.clientKey,
				}),
			recovery: TokenSetClientRegistryError.recoveryForCode(options.code),
			source: TokenSetClientRegistryErrorSource,
			cause: options.cause,
		});
		this.name = "TokenSetClientRegistryError";
		this.code = options.code;
		this.clientKey = options.clientKey ?? null;
	}

	static kindForCode(code: TokenSetClientRegistryErrorCode) {
		switch (code) {
			case TokenSetClientRegistryErrorCode.ClientRegistered:
			case TokenSetClientRegistryErrorCode.ClientUnregistered:
				return ClientErrorKind.Configuration;
			case TokenSetClientRegistryErrorCode.ClientFactoryFailed:
				return ClientErrorKind.Internal;
		}
	}

	static recoveryForCode(code: TokenSetClientRegistryErrorCode) {
		switch (code) {
			case TokenSetClientRegistryErrorCode.ClientRegistered:
			case TokenSetClientRegistryErrorCode.ClientUnregistered:
				return UserRecovery.ContactSupport;
			case TokenSetClientRegistryErrorCode.ClientFactoryFailed:
				return UserRecovery.Retry;
		}
	}

	static defaultErrorMessage(options: {
		code: TokenSetClientRegistryErrorCode;
		clientKey: string | undefined;
	}) {
		switch (options.code) {
			case TokenSetClientRegistryErrorCode.ClientUnregistered:
				return `[TokenSetClientRegistry] Client "${options.clientKey ?? "<unknown>"}" was unregistered when accessing.`;
			case TokenSetClientRegistryErrorCode.ClientRegistered:
				return `[TokenSetClientRegistry] Client "${options.clientKey ?? "<unknown>"}" was already registered.`;
			case TokenSetClientRegistryErrorCode.ClientFactoryFailed:
				return `[TokenSetClientRegistry] Client factory for "${options.clientKey ?? "<unknown>"}" failed.`;
		}
	}
}
