import {
	ClientError,
	ClientErrorKind,
	UserRecovery,
} from "@securitydept/client";

export const ClientRegistryErrorCode = {
	ClientUnregistered: "client_unregistered",
	ClientRegistered: "client_registered",
	CallbackClientNotFound: "callback_client_not_found",
	CallbackClientModeMismatch: "callback_client_mode_mismatch",
} as const;

export type ClientRegistryErrorCode =
	(typeof ClientRegistryErrorCode)[keyof typeof ClientRegistryErrorCode];

export class ClientRegistryError extends ClientError {
	override readonly code: ClientRegistryErrorCode;
	readonly clientKey: string | null;

	constructor(options: {
		code: ClientRegistryErrorCode;
		clientKey?: string;
		expectedMode?: string;
		actualMode?: string;
		currentUrl?: string;
		message?: string;
		cause?: unknown;
	}) {
		super({
			kind: ClientRegistryError.kindForCode(options.code),
			code: options.code,
			message:
				options.message ??
				ClientRegistryError.defaultErrorMessage({
					code: options.code,
					clientKey: options.clientKey,
					expectedMode: options.expectedMode,
					actualMode: options.actualMode,
					currentUrl: options.currentUrl,
				}),
			recovery: ClientRegistryError.recoveryForCode(options.code),
			retryable: false,
			source: "client_registry",
			cause: options.cause,
		});
		this.name = "ClientRegistryError";
		this.code = options.code;
		this.clientKey = options.clientKey ?? null;
	}

	static kindForCode(code: ClientRegistryErrorCode) {
		switch (code) {
			case ClientRegistryErrorCode.ClientRegistered:
			case ClientRegistryErrorCode.ClientUnregistered:
			case ClientRegistryErrorCode.CallbackClientNotFound:
				return ClientErrorKind.Configuration;
			case ClientRegistryErrorCode.CallbackClientModeMismatch:
				return ClientErrorKind.Protocol;
		}
	}

	static recoveryForCode(code: ClientRegistryErrorCode) {
		switch (code) {
			case ClientRegistryErrorCode.ClientRegistered:
			case ClientRegistryErrorCode.ClientUnregistered:
			case ClientRegistryErrorCode.CallbackClientNotFound:
				return UserRecovery.ContactSupport;
			case ClientRegistryErrorCode.CallbackClientModeMismatch:
				return UserRecovery.RestartFlow;
		}
	}

	static defaultErrorMessage(options: {
		code: ClientRegistryErrorCode;
		clientKey: string | undefined;
		expectedMode?: string;
		actualMode?: string;
		currentUrl?: string;
	}) {
		switch (options.code) {
			case ClientRegistryErrorCode.ClientUnregistered:
				return `[ClientRegistry] Client "${options.clientKey ?? "<unknown>"}" was unregistered when accessing.`;
			case ClientRegistryErrorCode.ClientRegistered:
				return `[ClientRegistry] Client "${options.clientKey ?? "<unknown>"}" was already registered.`;
			case ClientRegistryErrorCode.CallbackClientNotFound:
				return `[ClientRegistry] Cannot determine which client callback "${options.currentUrl ?? "<unknown>"}" belongs to.`;
			case ClientRegistryErrorCode.CallbackClientModeMismatch:
				return `[ClientRegistry] Client "${options.clientKey ?? "<unknown>"}" is not a ${options.expectedMode ?? "compatible"} client${options.actualMode ? `; received ${options.actualMode}` : ""}.`;
		}
	}
}
