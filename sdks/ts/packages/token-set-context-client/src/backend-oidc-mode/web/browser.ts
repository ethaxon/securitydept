import type {
	Clock,
	EphemeralFlowStore,
	HttpTransport,
	LoggerTrait,
	RecordStore,
	Scheduler,
	TraceEventSinkTrait,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createEphemeralFlowStore,
	createJsonCodec,
	FetchTransportRedirectKind,
	UserRecovery,
} from "@securitydept/client";
import {
	createLocalStorageStore,
	createSessionStorageStore,
} from "@securitydept/client/persistence/web";
import {
	createWebRuntime,
	type FetchTransportOptions,
	openPopupWindow,
	relayPopupCallback,
	waitForPopupRelay,
} from "@securitydept/client/web";
import { BackendOidcModeClient } from "../client";
import type { AuthStateSnapshot } from "../types";

const BACKEND_OIDC_PERSISTENT_PREFIX = "securitydept.web.backend_oidc:";
const BACKEND_OIDC_SESSION_PREFIX = "securitydept.web.backend_oidc:";
const TOKEN_SET_CALLBACK_FRAGMENT_KEY = "pending_callback_fragment";

/**
 * Returns the storage key used for the callback fragment ephemeral store.
 *
 * When `persistentStateKey` is provided, the returned key is namespaced under
 * it so that multiple independent backend-oidc integrations sharing the same
 * session store do not overwrite each other's pending callback fragments.
 *
 * Use this helper when constructing {@link createBackendOidcModeCallbackFragmentStore}
 * manually for a client that was created with a custom `persistentStateKey`.
 */
export function resolveBackendOidcModeCallbackFragmentKey(
	persistentStateKey?: string,
): string {
	return persistentStateKey
		? `${persistentStateKey}:callback_fragment`
		: TOKEN_SET_CALLBACK_FRAGMENT_KEY;
}

export interface LocationLike {
	href: string;
	hash: string;
}

export interface HistoryLike {
	replaceState(data: unknown, unused: string, url?: string): void;
}

export const BackendOidcModeBootstrapSource = {
	Callback: "callback",
	Restore: "restore",
	Empty: "empty",
} as const;
export type BackendOidcModeBootstrapSource =
	(typeof BackendOidcModeBootstrapSource)[keyof typeof BackendOidcModeBootstrapSource];

export interface BackendOidcModeBootstrapResult {
	source: BackendOidcModeBootstrapSource;
	snapshot: AuthStateSnapshot | null;
}

/**
 * Options for {@link createBackendOidcModeBrowserClient}.
 *
 * This interface exposes **every field** of {@link BackendOidcModeClientConfig}
 * so that browser adopters never need to fall back to the raw
 * `BackendOidcModeClient` constructor just to set a config value.
 *
 * In addition, it exposes browser-specific runtime wiring that the raw client
 * does not own:
 *
 * - `persistentStore` / `sessionStore` — browser storage adapters
 *   (defaults to `localStorage` / `sessionStorage` with an SDK-managed prefix)
 * - `transport` / `scheduler` / `clock` / `logger` / `traceSink` — runtime
 *   capabilities (defaults provided by `createWebRuntime`)
 * - `fetchTransport` — browser-native fetch transport configuration
 *   (only used when `transport` is **not** provided)
 *
 * **`transport` vs `fetchTransport` priority:**
 *
 * - When `transport` is provided, it is used as-is and `fetchTransport` is
 *   ignored.
 * - When `transport` is omitted, the entry creates a default `fetch`-based
 *   transport via `createWebRuntime`. In that path, `fetchTransport` options
 *   are merged with the SDK default (`redirect: "manual"`) so adopters can
 *   tune fetch behavior without replacing the entire transport.
 *
 * If you need full control over the `ClientRuntime`, construct
 * `BackendOidcModeClient` directly instead.
 */
export interface CreateBackendOidcModeBrowserClientOptions {
	// --- BackendOidcModeClientConfig fields (full parity) ---

	baseUrl?: string;
	defaultPostAuthRedirectUri?: string;
	refreshWindowMs?: number;
	/**
	 * Custom persistence key for persisted auth state.
	 *
	 * SDK default: `"securitydept.backend_oidc:v1:{baseUrl}"`.
	 *
	 * Pass a custom key when multiple independent backend-oidc integrations
	 * share the same origin and must not collide in storage.
	 *
	 * To also isolate callback fragments, pass the same key to
	 * {@link bootstrapBackendOidcModeClient} as `callbackFragmentKey` using
	 * {@link resolveBackendOidcModeCallbackFragmentKey}.
	 */
	persistentStateKey?: string;
	/**
	 * Path overrides for adopters whose backend uses a non-default route
	 * family. For example, `securitydept-server` uses `/auth/token-set/*`
	 * instead of the SDK defaults (`/auth/oidc/*`).
	 */
	loginPath?: string;
	refreshPath?: string;
	metadataRedeemPath?: string;
	userInfoPath?: string;

	// --- Browser runtime wiring (not part of BackendOidcModeClientConfig) ---

	persistentStore?: RecordStore;
	sessionStore?: RecordStore;
	/**
	 * Fully custom transport — replaces the default `fetch`-based transport.
	 *
	 * When provided, `fetchTransport` is ignored.
	 */
	transport?: HttpTransport;
	/**
	 * Configuration for the default browser `fetch` transport.
	 *
	 * Only used when `transport` is **not** provided. Fields are merged with
	 * the SDK default (`redirect: "manual"`), so callers only need to specify
	 * the overrides they care about.
	 */
	fetchTransport?: FetchTransportOptions;
	scheduler?: Scheduler;
	clock?: Clock;
	logger?: LoggerTrait;
	traceSink?: TraceEventSinkTrait;
}

export function createBackendOidcModeBrowserClient(
	options: CreateBackendOidcModeBrowserClientOptions = {},
): BackendOidcModeClient {
	const runtime = createWebRuntime({
		transport: options.transport,
		scheduler: options.scheduler,
		clock: options.clock,
		logger: options.logger,
		traceSink: options.traceSink,
		persistentStore:
			options.persistentStore ??
			createLocalStorageStore(BACKEND_OIDC_PERSISTENT_PREFIX),
		sessionStore:
			options.sessionStore ??
			createSessionStorageStore(BACKEND_OIDC_SESSION_PREFIX),
		fetchTransport: {
			redirect: FetchTransportRedirectKind.Manual,
			...options.fetchTransport,
		},
	});

	return new BackendOidcModeClient(
		{
			baseUrl: options.baseUrl ?? "",
			defaultPostAuthRedirectUri: options.defaultPostAuthRedirectUri,
			refreshWindowMs: options.refreshWindowMs,
			persistentStateKey: options.persistentStateKey,
			loginPath: options.loginPath,
			refreshPath: options.refreshPath,
			metadataRedeemPath: options.metadataRedeemPath,
			userInfoPath: options.userInfoPath,
		},
		runtime,
	);
}

export interface CreateBackendOidcModeCallbackFragmentStoreOptions {
	sessionStore?: RecordStore;
	key?: string;
}

export function createBackendOidcModeCallbackFragmentStore(
	options: CreateBackendOidcModeCallbackFragmentStoreOptions = {},
): EphemeralFlowStore<string> {
	return createEphemeralFlowStore<string>({
		store:
			options.sessionStore ??
			createSessionStorageStore(BACKEND_OIDC_SESSION_PREFIX),
		key: options.key ?? TOKEN_SET_CALLBACK_FRAGMENT_KEY,
		codec: createJsonCodec<string>(),
	});
}

export function resolveBackendOidcModeReturnUri(
	location: Pick<LocationLike, "href"> = window.location,
): string {
	const url = new URL(location.href);
	url.hash = "";
	return url.toString();
}

export interface CaptureBackendOidcModeCallbackFragmentFromUrlOptions {
	location?: LocationLike;
	history?: HistoryLike;
	callbackFragmentStore?: EphemeralFlowStore<string>;
	/**
	 * Storage key for the callback fragment ephemeral store.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 * Use {@link resolveBackendOidcModeCallbackFragmentKey} to derive a
	 * namespaced key from `persistentStateKey`.
	 */
	callbackFragmentKey?: string;
	/**
	 * Session store to back the default callback fragment store.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 * Should be the same store passed to {@link createBackendOidcModeBrowserClient}
	 * as `sessionStore`.
	 */
	sessionStore?: RecordStore;
}

export async function captureBackendOidcModeCallbackFragmentFromUrl(
	options: CaptureBackendOidcModeCallbackFragmentFromUrlOptions = {},
): Promise<string | null> {
	const location = options.location ?? window.location;
	const history = options.history ?? window.history;
	const callbackFragmentStore =
		options.callbackFragmentStore ??
		createBackendOidcModeCallbackFragmentStore({
			sessionStore: options.sessionStore,
			key: options.callbackFragmentKey,
		});
	const fragment = location.hash.startsWith("#")
		? location.hash.slice(1)
		: location.hash;

	if (!fragment) {
		return null;
	}

	await callbackFragmentStore.save(fragment);
	const url = new URL(location.href);
	url.hash = "";
	history.replaceState(null, "", `${url.pathname}${url.search}`);
	return fragment;
}

export interface BootstrapBackendOidcModeClientOptions {
	location?: LocationLike;
	history?: HistoryLike;
	callbackFragmentStore?: EphemeralFlowStore<string>;
	/**
	 * Storage key for the callback fragment ephemeral store.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 * Multiple backend-oidc integrations sharing a session store should
	 * each pass a distinct key — use
	 * {@link resolveBackendOidcModeCallbackFragmentKey} to derive one from
	 * the same `persistentStateKey` used in
	 * {@link createBackendOidcModeBrowserClient}.
	 */
	callbackFragmentKey?: string;
	/**
	 * Session store to back the default callback fragment store.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 * Should be the same store passed to {@link createBackendOidcModeBrowserClient}
	 * as `sessionStore`.
	 */
	sessionStore?: RecordStore;
}

export async function bootstrapBackendOidcModeClient(
	client: BackendOidcModeClient,
	options: BootstrapBackendOidcModeClientOptions = {},
): Promise<BackendOidcModeBootstrapResult> {
	const callbackFragmentStore =
		options.callbackFragmentStore ??
		createBackendOidcModeCallbackFragmentStore({
			sessionStore: options.sessionStore,
			key: options.callbackFragmentKey,
		});

	await captureBackendOidcModeCallbackFragmentFromUrl({
		location: options.location,
		history: options.history,
		callbackFragmentStore,
	});

	const pendingFragment = await callbackFragmentStore.load();
	if (pendingFragment) {
		try {
			const snapshot = await client.handleCallback(pendingFragment);
			await callbackFragmentStore.clear();
			return {
				source: BackendOidcModeBootstrapSource.Callback,
				snapshot,
			};
		} catch (error) {
			if (!shouldRetainCallbackFragment(error)) {
				await callbackFragmentStore.clear();
			}
			throw error;
		}
	}

	const restored = await client.restorePersistedState();
	if (restored) {
		return {
			source: BackendOidcModeBootstrapSource.Restore,
			snapshot: restored,
		};
	}

	return {
		source: BackendOidcModeBootstrapSource.Empty,
		snapshot: null,
	};
}

export function resolveBackendOidcModeAuthorizeUrl(
	client: BackendOidcModeClient,
	location: Pick<LocationLike, "href"> = window.location,
): string {
	return client.authorizeUrl(resolveBackendOidcModeReturnUri(location));
}

/**
 * Options for {@link loginWithBackendOidcRedirect}.
 */
export interface LoginWithBackendOidcRedirectOptions {
	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, the current `window.location.href` (minus the hash) is
	 * used as the return URI.
	 */
	postAuthRedirectUri?: string;
	/** Override the location used to derive the default return URI. */
	location?: Pick<LocationLike, "href">;
}

/**
 * One-shot browser redirect to the backend OIDC login endpoint.
 *
 * Resolves the authorize URL from the client and navigates the current
 * window.  This is the recommended browser entry point for initiating
 * backend-oidc login when using the `/web` convenience layer.
 */
export function loginWithBackendOidcRedirect(
	client: BackendOidcModeClient,
	options: LoginWithBackendOidcRedirectOptions = {},
): void {
	const location = options.location ?? window.location;
	const postAuthRedirectUri =
		options.postAuthRedirectUri ?? resolveBackendOidcModeReturnUri(location);

	window.location.href = client.authorizeUrl(postAuthRedirectUri);
}

// ---------------------------------------------------------------------------
// Popup-based login
// ---------------------------------------------------------------------------

/**
 * Options for {@link loginWithBackendOidcPopup}.
 */
export interface LoginWithBackendOidcPopupOptions {
	/**
	 * Where to redirect the user after the popup flow completes
	 * (the popup callback URL that will relay back to the opener).
	 *
	 * This should be a page that calls `relayBackendOidcPopupCallback()`.
	 */
	popupCallbackUrl: string;
	/** Popup window width in pixels (default: 500). */
	popupWidth?: number;
	/** Popup window height in pixels (default: 600). */
	popupHeight?: number;
	/** Maximum time in ms to wait for the popup relay (default: 120000). */
	timeoutMs?: number;
	/**
	 * Override the callback fragment store.
	 *
	 * When provided, this store is used directly. When omitted, a store is
	 * constructed from `callbackFragmentKey` / `sessionStore` (or SDK defaults).
	 *
	 * For same-origin multi-integration scenarios, pass the same namespaced
	 * store used in `createBackendOidcModeBrowserClient` / `bootstrapBackendOidcModeClient`.
	 */
	callbackFragmentStore?: EphemeralFlowStore<string>;
	/**
	 * Storage key for the callback fragment ephemeral store.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 * Use {@link resolveBackendOidcModeCallbackFragmentKey} to derive a
	 * namespaced key from `persistentStateKey`.
	 */
	callbackFragmentKey?: string;
	/**
	 * Override the session store used for the callback fragment.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 */
	sessionStore?: RecordStore;
}

/**
 * Initiate backend-oidc login via a popup window.
 *
 * Opens a popup to the backend OIDC authorize URL, waits for the popup
 * callback page to relay the result back via `postMessage`, then processes
 * the callback fragment through the existing bootstrap pipeline.
 *
 * Fragment store resolution follows the same priority as other browser helpers:
 * `callbackFragmentStore` > `callbackFragmentKey` + `sessionStore` > SDK defaults.
 *
 * @returns The bootstrap result from processing the callback.
 */
export async function loginWithBackendOidcPopup(
	client: BackendOidcModeClient,
	options: LoginWithBackendOidcPopupOptions,
): Promise<BackendOidcModeBootstrapResult> {
	const authorizeUrl = client.authorizeUrl(options.popupCallbackUrl);

	const popup = openPopupWindow(authorizeUrl, {
		width: options.popupWidth,
		height: options.popupHeight,
	});

	// Wait for the popup callback page to relay the callback URL.
	const callbackUrl = await waitForPopupRelay({
		popup,
		timeoutMs: options.timeoutMs,
	});

	// Extract the callback fragment from the relayed URL.
	const url = new URL(callbackUrl);
	const hash = url.hash;

	if (!hash || hash === "#") {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "backend_oidc.popup.no_fragment",
			message: "Popup callback URL has no fragment to process.",
			source: "backend-oidc-mode",
		});
	}

	// Resolve fragment store using the same priority as other browser helpers.
	const fragmentStore =
		options.callbackFragmentStore ??
		createBackendOidcModeCallbackFragmentStore({
			key: options.callbackFragmentKey,
			sessionStore: options.sessionStore,
		});
	await fragmentStore.save(hash.slice(1));

	return bootstrapBackendOidcModeClient(client, {
		callbackFragmentStore: fragmentStore,
	});
}

/**
 * Relay the backend-oidc popup callback result back to the opener window.
 *
 * Call this from the popup callback page. It posts the full callback URL
 * (including fragment) back to the opener and closes the popup.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { relayBackendOidcPopupCallback } from "@securitydept/token-set-context-client/backend-oidc-mode/web";
 *   relayBackendOidcPopupCallback();
 * </script>
 * ```
 */
export function relayBackendOidcPopupCallback(options?: {
	targetOrigin?: string;
}): void {
	relayPopupCallback({
		payload: window.location.href,
		targetOrigin: options?.targetOrigin,
	});
}

/**
 * Clear all browser-side auth state: persisted auth snapshot and any pending
 * callback fragment.
 *
 * **Fragment store resolution priority:**
 *
 * 1. `callbackFragmentStore` — used as-is when explicitly provided.
 * 2. `callbackFragmentKey` / `sessionStore` — used to construct the default
 *    fragment store when `callbackFragmentStore` is not supplied.  For
 *    same-origin multi-integration scenarios, pass the same namespaced key
 *    via {@link resolveBackendOidcModeCallbackFragmentKey} and the same
 *    `sessionStore` used in {@link createBackendOidcModeBrowserClient} /
 *    {@link bootstrapBackendOidcModeClient}.
 * 3. SDK defaults — global session store + default fragment key.
 */
export interface ResetBackendOidcModeBrowserStateOptions {
	callbackFragmentStore?: EphemeralFlowStore<string>;
	/**
	 * Storage key for the callback fragment ephemeral store.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 * Use {@link resolveBackendOidcModeCallbackFragmentKey} to derive a
	 * namespaced key from `persistentStateKey`.
	 */
	callbackFragmentKey?: string;
	/**
	 * Session store to back the default callback fragment store.
	 *
	 * Only used when `callbackFragmentStore` is not explicitly supplied.
	 * Should be the same store passed to {@link createBackendOidcModeBrowserClient}
	 * as `sessionStore`.
	 */
	sessionStore?: RecordStore;
}

export async function resetBackendOidcModeBrowserState(
	client: BackendOidcModeClient,
	options: ResetBackendOidcModeBrowserStateOptions = {},
): Promise<void> {
	const callbackFragmentStore =
		options.callbackFragmentStore ??
		createBackendOidcModeCallbackFragmentStore({
			sessionStore: options.sessionStore,
			key: options.callbackFragmentKey,
		});
	await callbackFragmentStore.clear();
	await client.clearState();
}

function isCancelledClientError(error: unknown): boolean {
	return error instanceof ClientError
		? error.kind === ClientErrorKind.Cancelled
		: typeof error === "object" &&
				error !== null &&
				"kind" in error &&
				error.kind === ClientErrorKind.Cancelled;
}

function shouldRetainCallbackFragment(error: unknown): boolean {
	if (isCancelledClientError(error)) {
		return true;
	}

	if (error instanceof ClientError) {
		return error.retryable;
	}

	return (
		typeof error === "object" &&
		error !== null &&
		(("retryable" in error && error.retryable === true) ||
			("recovery" in error && error.recovery === UserRecovery.Retry))
	);
}
