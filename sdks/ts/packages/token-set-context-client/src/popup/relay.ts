import {
	ClientError,
	ClientErrorKind,
	type PopupClientWindowHandleTrait,
	PopupErrorCode,
	type PopupServerWindowHandleTrait,
	type TimeTrait,
	UserRecovery,
} from "@securitydept/client";

export const TokenSetPopupRelayErrorCode = {
	Timeout: "token_set.popup_relay_timeout",
	Protocol: "token_set.popup_relay_protocol_error",
	Payload: "token_set.popup_relay_payload_error",
} as const;

export type TokenSetPopupRelayErrorCode =
	(typeof TokenSetPopupRelayErrorCode)[keyof typeof TokenSetPopupRelayErrorCode];

export const TokenSetPopupRelayMethod = {
	Callback: "securitydept.token_set.popup.callback",
} as const;

interface PopupRelayNotification {
	payload?: string;
	error?: string;
}

export interface WaitForTokenSetPopupRelayOptions {
	popup: PopupClientWindowHandleTrait;
	time: TimeTrait;
	timeoutMs?: number;
}

export interface RelayTokenSetPopupCallbackOptions {
	popup: PopupServerWindowHandleTrait;
	payload: string;
	error?: string;
	closeAfterRelay?: boolean;
}

export async function waitForTokenSetPopupRelay(
	options: WaitForTokenSetPopupRelayOptions,
): Promise<string> {
	const timeoutMs = options.timeoutMs ?? 120_000;

	return await new Promise<string>((resolve, reject) => {
		let settled = false;
		let timeoutHandle: unknown;

		const closePopup = () => {
			options.popup.dispose();
			try {
				options.popup.close();
			} catch {
				// Best-effort close.
			}
		};

		const notificationSubscription = options.popup.onNotification.subscribe({
			next(event) {
				if (event.method !== TokenSetPopupRelayMethod.Callback) {
					return;
				}

				const payload = event.params as PopupRelayNotification | undefined;
				cleanup();

				if (payload?.error) {
					closePopup();
					reject(
						new ClientError({
							kind: ClientErrorKind.Protocol,
							code: TokenSetPopupRelayErrorCode.Payload,
							message: `Popup callback relay error: ${payload.error}`,
							recovery: UserRecovery.RestartFlow,
							source: "token-set-popup-relay",
						}),
					);
					return;
				}

				if (typeof payload?.payload !== "string") {
					closePopup();
					reject(
						new ClientError({
							kind: ClientErrorKind.Protocol,
							code: TokenSetPopupRelayErrorCode.Protocol,
							message: "Popup callback relay payload is missing.",
							recovery: UserRecovery.RestartFlow,
							source: "token-set-popup-relay",
						}),
					);
					return;
				}

				closePopup();
				resolve(payload.payload);
			},
			error(error) {
				cleanup();
				closePopup();
				reject(mapTokenSetPopupRelayError(error));
			},
		});

		const cleanup = () => {
			settled = true;
			if (timeoutHandle !== undefined) {
				options.time.clearTimeout(timeoutHandle);
			}
			notificationSubscription.unsubscribe();
		};

		timeoutHandle = options.time.setTimeout(() => {
			if (settled) {
				return;
			}
			cleanup();
			closePopup();
			reject(
				new ClientError({
					kind: ClientErrorKind.Timeout,
					code: TokenSetPopupRelayErrorCode.Timeout,
					message: `Popup login timed out after ${timeoutMs}ms.`,
					recovery: UserRecovery.Retry,
					source: "token-set-popup-relay",
				}),
			);
		}, timeoutMs);
	});
}

export function relayTokenSetPopupCallback(
	options: RelayTokenSetPopupCallbackOptions,
): void {
	void options.popup
		.notify(TokenSetPopupRelayMethod.Callback, {
			payload: options.payload,
			error: options.error,
		} satisfies PopupRelayNotification)
		.catch(() => undefined)
		.finally(() => {
			if (options.closeAfterRelay === false) {
				return;
			}

			try {
				options.popup.close();
			} catch {
				// Best-effort close.
			}
			options.popup.dispose();
		});
}

function mapTokenSetPopupRelayError(error: unknown): ClientError {
	if (error instanceof ClientError && error.code === PopupErrorCode.Closed) {
		return error;
	}

	const message = error instanceof Error ? error.message : String(error);
	return new ClientError({
		kind: ClientErrorKind.Protocol,
		code: TokenSetPopupRelayErrorCode.Protocol,
		message,
		recovery: UserRecovery.RestartFlow,
		source: "token-set-popup-relay",
	});
}
