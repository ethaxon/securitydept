import {
	ClientError,
	ClientErrorKind,
	type FoundationEnvironment,
	type PopupClientWindowHandleTrait,
	type PopupServerWindowHandleTrait,
	type TimeTrait,
	UserRecovery,
} from "@securitydept/client";
import { createAsyncSchedulerWithTimestampProvider } from "@securitydept/client/rx";
import {
	filter,
	firstValueFrom,
	from,
	TimeoutError,
	take,
	timeout,
} from "rxjs";

export const TokenSetPopupRelayErrorCode = {
	Timeout: "token_set.popup_relay_timeout",
	Protocol: "token_set.popup_relay_protocol_error",
	Payload: "token_set.popup_relay_payload_error",
	AttachUnavailable: "token_set.popup_relay.attach_unavailable",
	CallbackUrlMissing: "token_set.popup_relay.callback_url_missing",
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

export async function waitForTokenSetPopupRelay({
	popup,
	time,
	timeoutMs = 120_000,
}: WaitForTokenSetPopupRelayOptions): Promise<string> {
	try {
		const callbackNotification = await firstValueFrom(
			from(popup.onNotification).pipe(
				filter((event) => event.method === TokenSetPopupRelayMethod.Callback),
				take(1),
				timeout({
					first: timeoutMs,
					scheduler: createAsyncSchedulerWithTimestampProvider(time),
				}),
			),
		);

		const relayPayload = callbackNotification.params as
			| PopupRelayNotification
			| undefined;

		if (relayPayload?.error) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: TokenSetPopupRelayErrorCode.Payload,
				message: `Popup callback relay error: ${relayPayload.error}`,
				recovery: UserRecovery.RestartFlow,
				source: "token-set-popup-relay",
			});
		}

		if (typeof relayPayload?.payload !== "string") {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: TokenSetPopupRelayErrorCode.Protocol,
				message: "Popup callback relay payload is missing.",
				recovery: UserRecovery.RestartFlow,
				source: "token-set-popup-relay",
			});
		}

		return relayPayload.payload;
	} catch (error) {
		if (error instanceof ClientError) {
			throw error;
		}
		if (error instanceof TimeoutError) {
			throw new ClientError({
				kind: ClientErrorKind.Timeout,
				code: TokenSetPopupRelayErrorCode.Timeout,
				message: `Popup login timed out after ${timeoutMs}ms.`,
				recovery: UserRecovery.Retry,
				source: "token-set-popup-relay",
			});
		}

		const message = error instanceof Error ? error.message : String(error);
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: TokenSetPopupRelayErrorCode.Protocol,
			message,
			recovery: UserRecovery.RestartFlow,
			source: "token-set-popup-relay",
		});
	} finally {
		popup.dispose();
		try {
			popup.close();
		} catch {
			// Best-effort close.
		}
	}
}

export async function relayTokenSetPopupCallback({
	popup,
	payload,
	error,
	closeAfterRelay = true,
}: RelayTokenSetPopupCallbackOptions): Promise<void> {
	try {
		await popup.notify(TokenSetPopupRelayMethod.Callback, {
			payload,
			error,
		} satisfies PopupRelayNotification);
	} catch {
		// Best-effort relay.
	} finally {
		if (closeAfterRelay !== false) {
			try {
				popup.close();
			} catch {
				// Best-effort close.
			}
			popup.dispose();
		}
	}
}

/**
 * Relay the popup OIDC callback URL from this page back to the opener window.
 *
 * Call this from a popup callback page. It attaches through `environment.popup`,
 * reads the current URL through `environment.router`, posts it back to the opener,
 * and closes the popup. Frontend-oidc callbacks typically carry query parameters
 * (`code`, `state`); backend-oidc callbacks may include a compat fragment.
 *
 * Returns a promise that resolves after the relay attempt finishes. Callers may
 * fire-and-forget with `void relayTokenSetPopupCallbackFromEnvironment(...)`.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
 *   import { relayTokenSetPopupCallbackFromEnvironment } from "@securitydept/token-set-context-client/frontend-oidc-mode";
 *   void relayTokenSetPopupCallbackFromEnvironment(
 *     createEnvironmentForNativeWeb({
 *       routerForNativeWebCreateOptions: { location, history },
 *     }),
 *   );
 * </script>
 * ```
 */
export async function relayTokenSetPopupCallbackFromEnvironment(
	environment: FoundationEnvironment,
): Promise<void> {
	const attachedPopup = environment.popup?.attach();
	if (!attachedPopup || attachedPopup.kind === "failure") {
		throw (
			attachedPopup?.error ??
			new ClientError({
				kind: ClientErrorKind.Configuration,
				code: TokenSetPopupRelayErrorCode.AttachUnavailable,
				message: "Popup callback relay requires environment.popup.attach().",
				source: "token-set-popup-relay",
				recovery: UserRecovery.RestartFlow,
			})
		);
	}
	const callbackUrl = environment.router?.currentUrl()?.toString();
	if (!callbackUrl) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			code: TokenSetPopupRelayErrorCode.CallbackUrlMissing,
			message: "Popup callback relay requires environment.router.currentUrl().",
			source: "token-set-popup-relay",
			recovery: UserRecovery.RestartFlow,
		});
	}
	await relayTokenSetPopupCallback({
		popup: attachedPopup.handle,
		payload: callbackUrl,
	});
}
