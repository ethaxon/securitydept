import {
	type CancellationTokenTrait,
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
	merge,
	mergeMap,
	NEVER,
	TimeoutError,
	take,
	takeUntil,
	throwError,
	timeout,
} from "rxjs";

export const TokenSetPopupRelayErrorCode = {
	Timeout: "token_set.popup_relay.timeout",
	Protocol: "token_set.popup_relay.protocol",
	Payload: "token_set.popup_relay.payload",
	AttachUnavailable: "token_set.popup_relay.attach_unavailable",
	CallbackUrlMissing: "token_set.popup_relay.callback_url_missing",
} as const;

export type TokenSetPopupRelayErrorCode =
	(typeof TokenSetPopupRelayErrorCode)[keyof typeof TokenSetPopupRelayErrorCode];

export const TokenSetPopupRelayErrorSource = "token_set.popup_relay";

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
	cancellationToken?: CancellationTokenTrait;
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
	const { popup, time, timeoutMs = 120_000, cancellationToken } = options;
	try {
		const callbackNotification = await firstValueFrom(
			merge(
				from(popup.onNotification).pipe(
					filter((event) => event.method === TokenSetPopupRelayMethod.Callback),
				),
				from(popup.failure).pipe(
					filter((error): error is ClientError => error !== null),
					mergeMap((error) => throwError(() => error)),
				),
			).pipe(
				take(1),
				timeout({
					first: timeoutMs,
					scheduler: createAsyncSchedulerWithTimestampProvider(time),
				}),
				takeUntil(cancellationToken ? from(cancellationToken) : NEVER),
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
				source: TokenSetPopupRelayErrorSource,
			});
		}

		if (typeof relayPayload?.payload !== "string") {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: TokenSetPopupRelayErrorCode.Protocol,
				message: "Popup callback relay payload is missing.",
				recovery: UserRecovery.RestartFlow,
				source: TokenSetPopupRelayErrorSource,
			});
		}

		return relayPayload.payload;
	} catch (error) {
		cancellationToken?.throwIfCancellationRequested();
		if (error instanceof ClientError) {
			throw error;
		}
		if (error instanceof TimeoutError) {
			throw new ClientError({
				kind: ClientErrorKind.Timeout,
				code: TokenSetPopupRelayErrorCode.Timeout,
				message: `Popup login timed out after ${timeoutMs}ms.`,
				recovery: UserRecovery.Retry,
				source: TokenSetPopupRelayErrorSource,
			});
		}

		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: TokenSetPopupRelayErrorCode.Protocol,
			message: "The popup callback relay failed unexpectedly.",
			recovery: UserRecovery.RestartFlow,
			source: TokenSetPopupRelayErrorSource,
			cause: error,
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
				source: TokenSetPopupRelayErrorSource,
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
			source: TokenSetPopupRelayErrorSource,
			recovery: UserRecovery.RestartFlow,
		});
	}
	await relayTokenSetPopupCallback({
		popup: attachedPopup.handle,
		payload: callbackUrl,
	});
}
