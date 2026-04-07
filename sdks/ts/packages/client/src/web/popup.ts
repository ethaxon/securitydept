// Popup shared infrastructure — browser-only helpers
//
// Provides cross-mode popup window management for login flows.
// Owned by @securitydept/client/web, consumed by backend-oidc-mode
// and frontend-oidc-mode popup login entries.

import { ClientError, ClientErrorKind, UserRecovery } from "../errors/index";

// ---------------------------------------------------------------------------
// Error codes (stable contract)
// ---------------------------------------------------------------------------

/** Stable error codes for popup-related failures. */
export const PopupErrorCode = {
	/** The browser blocked the popup window from opening. */
	Blocked: "popup.blocked",
	/** The popup was closed by the user before completing the flow. */
	Closed: "popup.closed_by_user",
	/** The relay message was not received within the timeout. */
	Timeout: "popup.relay_timeout",
	/** The relay message contained an error from the callback page. */
	RelayError: "popup.relay_error",
	/** An unexpected error occurred during popup lifecycle. */
	Internal: "popup.internal",
} as const;

export type PopupErrorCode =
	(typeof PopupErrorCode)[keyof typeof PopupErrorCode];

// ---------------------------------------------------------------------------
// Popup features
// ---------------------------------------------------------------------------

/**
 * Options for computing the popup window features string.
 */
export interface PopupFeaturesOptions {
	/** Width in pixels (default: 500). */
	width?: number;
	/** Height in pixels (default: 600). */
	height?: number;
}

/**
 * Compute the `features` string for `window.open()`, centered on screen.
 */
export function computePopupFeatures(
	options: PopupFeaturesOptions = {},
): string {
	const width = options.width ?? 500;
	const height = options.height ?? 600;
	const left = Math.max(
		0,
		Math.round(window.screenX + (window.innerWidth - width) / 2),
	);
	const top = Math.max(
		0,
		Math.round(window.screenY + (window.innerHeight - height) / 2),
	);

	return `width=${width},height=${height},left=${left},top=${top},popup=yes,toolbar=no,menubar=no`;
}

// ---------------------------------------------------------------------------
// Popup open + blocked detection
// ---------------------------------------------------------------------------

/**
 * Result of opening a popup window.
 */
export interface PopupWindowHandle {
	/** The opened window reference. */
	window: Window;
}

/**
 * Open a popup window to the given URL.
 *
 * Throws a `ClientError` with code `popup.blocked` if the browser
 * blocks the popup.
 */
export function openPopupWindow(
	url: string,
	options?: PopupFeaturesOptions & { target?: string },
): PopupWindowHandle {
	const features = computePopupFeatures(options);
	const target = options?.target ?? "_blank";

	const win = window.open(url, target, features);

	if (!win || win.closed) {
		throw new ClientError({
			kind: ClientErrorKind.Authorization,
			code: PopupErrorCode.Blocked,
			message:
				"Popup window was blocked by the browser. Please allow popups for this site.",
			recovery: UserRecovery.Retry,
			source: "popup",
		});
	}

	return { window: win };
}

// ---------------------------------------------------------------------------
// PostMessage relay
// ---------------------------------------------------------------------------

/**
 * Expected shape of a relay message from the popup callback page.
 */
export interface PopupRelayMessage {
	/** Discriminator for the message type. */
	type: "securitydept:popup_callback";
	/** The callback URL or fragment received by the popup. */
	payload: string;
	/** Optional error from the callback page. */
	error?: string;
}

/**
 * Options for waiting for a popup relay message.
 */
export interface WaitForPopupRelayOptions {
	/** The popup window handle to monitor. */
	popup: PopupWindowHandle;
	/** Maximum time to wait in milliseconds (default: 120000 = 2 minutes). */
	timeoutMs?: number;
	/** Expected origin for the relay message (default: current origin). */
	expectedOrigin?: string;
	/** Poll interval for checking if the popup is closed (default: 500ms). */
	pollIntervalMs?: number;
}

/**
 * Wait for a relay message from a popup callback page.
 *
 * The popup callback page should call `relayPopupCallback()` to post
 * the callback URL back to the opener.
 *
 * Resolves with the callback payload (URL or fragment string).
 * Rejects with a `ClientError` if:
 *   - the popup is closed without relaying (popup.closed_by_user)
 *   - the timeout expires (popup.relay_timeout)
 *   - the relay message contains an error (popup.relay_error)
 */
export function waitForPopupRelay(
	options: WaitForPopupRelayOptions,
): Promise<string> {
	const timeoutMs = options.timeoutMs ?? 120_000;
	const expectedOrigin = options.expectedOrigin ?? window.location.origin;
	const pollIntervalMs = options.pollIntervalMs ?? 500;

	return new Promise<string>((resolve, reject) => {
		let settled = false;
		let timeoutId: ReturnType<typeof setTimeout>;
		let pollId: ReturnType<typeof setInterval>;

		function cleanup() {
			settled = true;
			clearTimeout(timeoutId);
			clearInterval(pollId);
			window.removeEventListener("message", onMessage);
		}

		function onMessage(event: MessageEvent) {
			if (settled) return;
			if (event.origin !== expectedOrigin) return;

			const data = event.data as PopupRelayMessage | undefined;
			if (!data || data.type !== "securitydept:popup_callback") return;

			cleanup();

			if (data.error) {
				reject(
					new ClientError({
						kind: ClientErrorKind.Protocol,
						code: PopupErrorCode.RelayError,
						message: `Popup callback relay error: ${data.error}`,
						source: "popup",
					}),
				);
				return;
			}

			resolve(data.payload);
		}

		// Listen for relay messages.
		window.addEventListener("message", onMessage);

		// Poll for popup closure.
		pollId = setInterval(() => {
			if (settled) return;
			if (options.popup.window.closed) {
				cleanup();
				reject(
					new ClientError({
						kind: ClientErrorKind.Authorization,
						code: PopupErrorCode.Closed,
						message:
							"Popup window was closed before completing the login flow.",
						recovery: UserRecovery.RestartFlow,
						source: "popup",
					}),
				);
			}
		}, pollIntervalMs);

		// Timeout.
		timeoutId = setTimeout(() => {
			if (settled) return;
			cleanup();
			try {
				options.popup.window.close();
			} catch {
				// Best-effort close.
			}
			reject(
				new ClientError({
					kind: ClientErrorKind.Timeout,
					code: PopupErrorCode.Timeout,
					message: `Popup login timed out after ${timeoutMs}ms.`,
					recovery: UserRecovery.Retry,
					source: "popup",
				}),
			);
		}, timeoutMs);
	});
}

// ---------------------------------------------------------------------------
// Popup callback relay (for use in popup callback pages)
// ---------------------------------------------------------------------------

/**
 * Options for relaying the callback from the popup window back to the opener.
 */
export interface RelayPopupCallbackOptions {
	/** The callback payload (URL or fragment) to relay. */
	payload?: string;
	/** An error message to relay instead of a successful payload. */
	error?: string;
	/** Whether to close the popup after relaying (default: true). */
	closeAfterRelay?: boolean;
	/** Target origin for the postMessage (default: current origin). */
	targetOrigin?: string;
}

/**
 * Relay the popup callback result back to the opener window.
 *
 * Call this function from the popup callback page to send the callback
 * URL/fragment back to the parent window that initiated the popup login.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { relayPopupCallback } from "@securitydept/client/web";
 *   relayPopupCallback({ payload: window.location.href });
 * </script>
 * ```
 */
export function relayPopupCallback(
	options: RelayPopupCallbackOptions = {},
): void {
	const opener = window.opener;
	if (!opener) {
		return;
	}

	const targetOrigin = options.targetOrigin ?? window.location.origin;
	const message: PopupRelayMessage = {
		type: "securitydept:popup_callback",
		payload: options.payload ?? window.location.href,
		error: options.error,
	};

	opener.postMessage(message, targetOrigin);

	if (options.closeAfterRelay !== false) {
		window.close();
	}
}
