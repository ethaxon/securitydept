import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";

export const TokenSetClientRegistryErrorCode = {
	ClientUnregistered: "client_unregistered",
	ClientRegistered: "client_registered",
	CallbackClientNotFound: "callback_client_not_found",
	CallbackClientModeMismatch: "callback_client_mode_mismatch",
} as const;

export type TokenSetClientRegistryErrorCode =
	(typeof TokenSetClientRegistryErrorCode)[keyof typeof TokenSetClientRegistryErrorCode];

export class TokenSetClientRegistryError extends ClientError {
	override readonly code: TokenSetClientRegistryErrorCode;
	readonly clientKey: string | null;

	constructor(options: {
		code: TokenSetClientRegistryErrorCode;
		clientKey?: string;
		expectedMode?: string;
		actualMode?: string;
		currentUrl?: string;
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
					expectedMode: options.expectedMode,
					actualMode: options.actualMode,
					currentUrl: options.currentUrl,
				}),
			recovery: TokenSetClientRegistryError.recoveryForCode(options.code),
			retryable: false,
			source: "client_registry",
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
			case TokenSetClientRegistryErrorCode.CallbackClientNotFound:
				return ClientErrorKind.Configuration;
			case TokenSetClientRegistryErrorCode.CallbackClientModeMismatch:
				return ClientErrorKind.Protocol;
		}
	}

	static recoveryForCode(code: TokenSetClientRegistryErrorCode) {
		switch (code) {
			case TokenSetClientRegistryErrorCode.ClientRegistered:
			case TokenSetClientRegistryErrorCode.ClientUnregistered:
			case TokenSetClientRegistryErrorCode.CallbackClientNotFound:
				return UserRecovery.ContactSupport;
			case TokenSetClientRegistryErrorCode.CallbackClientModeMismatch:
				return UserRecovery.RestartFlow;
		}
	}

	static defaultErrorMessage(options: {
		code: TokenSetClientRegistryErrorCode;
		clientKey: string | undefined;
		expectedMode?: string;
		actualMode?: string;
		currentUrl?: string;
	}) {
		switch (options.code) {
			case TokenSetClientRegistryErrorCode.ClientUnregistered:
				return `[TokenSetClientRegistry] Client "${options.clientKey ?? "<unknown>"}" was unregistered when accessing.`;
			case TokenSetClientRegistryErrorCode.ClientRegistered:
				return `[TokenSetClientRegistry] Client "${options.clientKey ?? "<unknown>"}" was already registered.`;
			case TokenSetClientRegistryErrorCode.CallbackClientNotFound:
				return `[TokenSetClientRegistry] Cannot determine which client callback "${options.currentUrl ?? "<unknown>"}" belongs to.`;
			case TokenSetClientRegistryErrorCode.CallbackClientModeMismatch:
				return `[TokenSetClientRegistry] Client "${options.clientKey ?? "<unknown>"}" is not a ${options.expectedMode ?? "compatible"} client${options.actualMode ? `; received ${options.actualMode}` : ""}.`;
		}
	}
}
