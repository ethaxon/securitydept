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
	type PageLocationCapability,
	type PageLocationHistoryCapability,
	UserRecovery,
	type WebClientEnvironment,
} from "@securitydept/client";
import {
	createLocalStorageStore,
	createSessionStorageStore,
} from "@securitydept/client/persistence/web";
import {
	assertResolveEnvironment,
	createWebClientEnvironment,
	deriveClientEnvironment,
	type FetchTransportOptions,
	openPopupWindow,
	relayPopupCallback,
	waitForPopupRelay,
} from "@securitydept/client/web";
import {
	attachTokenSetResumeReconciliation,
	type TokenSetResumeReconciliationOptions,
} from "../../orchestration";
import type {
	OidcRedirectLoginClient,
	OidcRedirectLoginOptions,
} from "../../registry/types";
import { BackendOidcModeClient } from "../client";
import type { AuthStateSnapshot } from "../types";

const BACKEND_OIDC_PERSISTENT_PREFIX = "securitydept.web.backend_oidc:";
const BACKEND_OIDC_SESSION_PREFIX = "securitydept.web.backend_oidc:";
const TOKEN_SET_CALLBACK_FRAGMENT_KEY = "pending_callback_fragment";
const BACKEND_OIDC_REDIRECT_LOGIN_ATTACHED = Symbol(
	"backend-oidc-redirect-login-attached",
);
const BACKEND_OIDC_PAGE_ENVIRONMENT_ERROR_MESSAGE =
	"backend-oidc page helpers require an explicit page environment.\n" +
	"Create one in your composition root with createBrowserPageClientEnvironment(...).";
const BACKEND_OIDC_PAGE_CALLBACK_ENVIRONMENT_ERROR_MESSAGE =
	"backend-oidc page callback helpers require an explicit page environment with callbackFragmentStore.\n" +
	"Create one in your composition root with createBackendOidcModeWebClientEnvironment(...), then pair it with page location/history capabilities from createBrowserPageClientEnvironment(...).";
const BACKEND_OIDC_CALLBACK_FRAGMENT_STORE_ERROR_MESSAGE =
	"backend-oidc popup/reset helpers require an explicit callbackFragmentStore capability.\n" +
	"Create one in your composition root with createBackendOidcModeWebClientEnvironment(...), then pass environment or callbackFragmentStore to the helper.";

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

export interface BackendOidcModeWebClientEnvironment
	extends WebClientEnvironment {
	callbackFragmentStore: EphemeralFlowStore<string>;
}

export interface BackendOidcModePageClientEnvironment
	extends BackendOidcModeWebClientEnvironment,
		PageLocationHistoryCapability {}

export interface BackendOidcModeCallbackFragmentStoreCapability {
	callbackFragmentStore: EphemeralFlowStore<string>;
}

export interface BackendOidcModePageLocationCapability
	extends PageLocationCapability {}

export interface BackendOidcModePageCallbackCapability
	extends BackendOidcModeCallbackFragmentStoreCapability,
		PageLocationHistoryCapability {}

export interface BackendOidcModePopupLoginCapability
	extends BackendOidcModeCallbackFragmentStoreCapability {}

export interface CreateBackendOidcModeWebClientEnvironmentOptions {
	environment?: BackendOidcModeWebClientEnvironment;
	persistentStateKey?: string;
	persistentStore?: RecordStore;
	sessionStore?: RecordStore;
	callbackFragmentStore?: EphemeralFlowStore<string>;
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

/**
 * Options for {@link createBackendOidcModeWebClient}.
 *
 * This interface exposes **every field** of {@link BackendOidcModeClientConfig}
 * so that browser adopters never need to fall back to the raw
 * `BackendOidcModeClient` constructor just to set a config value.
 * Browser runtime/stores must be composed ahead of time through
 * {@link createBackendOidcModeWebClientEnvironment} and passed here as
 * `environment`.
 */
export interface CreateBackendOidcModeWebClientOptions {
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
	 * {@link bootstrapBackendOidcModePageClient} as `callbackFragmentKey` using
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

	environment: BackendOidcModeWebClientEnvironment;
	resumeReconciliation?: boolean;
	resumeReconciliationOptions?: TokenSetResumeReconciliationOptions;
}

export interface BackendOidcModeWebClient
	extends BackendOidcModeClient,
		OidcRedirectLoginClient {}

export function createBackendOidcModeWebClientEnvironment(
	options: CreateBackendOidcModeWebClientEnvironmentOptions = {},
): BackendOidcModeWebClientEnvironment {
	if (options.environment) {
		return options.environment;
	}

	const environment = createWebClientEnvironment({
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

	return {
		...environment,
		callbackFragmentStore:
			options.callbackFragmentStore ??
			createBackendOidcModeCallbackFragmentStore({
				sessionStore: environment.sessionStore,
				key: options.persistentStateKey
					? resolveBackendOidcModeCallbackFragmentKey(
							options.persistentStateKey,
						)
					: undefined,
			}),
	};
}

export function createBackendOidcModeWebClient(
	options: CreateBackendOidcModeWebClientOptions,
): BackendOidcModeWebClient {
	const environment = options.environment;

	return attachBackendOidcRedirectLogin(
		attachTokenSetResumeReconciliation(
			new BackendOidcModeClient(
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
				deriveClientEnvironment(environment),
			),
			{
				resumeReconciliation: options.resumeReconciliation,
				resumeReconciliationOptions: options.resumeReconciliationOptions,
			},
		),
	);
}

function attachBackendOidcRedirectLogin<TClient extends BackendOidcModeClient>(
	client: TClient,
): TClient & OidcRedirectLoginClient {
	const redirectClient = client as TClient &
		OidcRedirectLoginClient & {
			[BACKEND_OIDC_REDIRECT_LOGIN_ATTACHED]?: true;
		};
	if (redirectClient[BACKEND_OIDC_REDIRECT_LOGIN_ATTACHED] === true) {
		return redirectClient;
	}
	Object.defineProperty(redirectClient, BACKEND_OIDC_REDIRECT_LOGIN_ATTACHED, {
		value: true,
		configurable: false,
		enumerable: false,
		writable: false,
	});
	redirectClient.loginWithRedirect = async (
		redirectOptions: OidcRedirectLoginOptions,
	) => {
		redirectToBackendOidcLogin(client, {
			environment: redirectOptions.environment,
			postAuthRedirectUri:
				redirectOptions.postAuthRedirectUri ??
				currentPageLocationAsPostAuthRedirectUri({
					environment: redirectOptions.environment,
				}),
		});
	};
	return redirectClient;
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

/**
 * Extract the current page URL (without hash) as a post-auth redirect URI.
 *
 * Useful when building an authorize URL that should return the user to
 * whichever page they are currently on.  The hash is stripped because
 * servers typically cannot relay fragment identifiers via 302 redirects.
 */
export interface CurrentPageLocationAsPostAuthRedirectUriOptions {
	environment?: BackendOidcModePageLocationCapability;
}

export function currentPageLocationAsPostAuthRedirectUri(
	options: CurrentPageLocationAsPostAuthRedirectUriOptions = {},
): string {
	const environment = assertResolveEnvironment(
		options.environment,
		failMissingBackendOidcPageEnvironment,
	);
	const url = new URL(environment.location.href);
	url.hash = "";
	return url.toString();
}

export interface CaptureBackendOidcModeCallbackFragmentOptions {
	environment: BackendOidcModePageCallbackCapability;
}

export async function captureBackendOidcModeCallbackFragment(
	options: CaptureBackendOidcModeCallbackFragmentOptions,
): Promise<string | null> {
	const environment = options.environment;
	const location = environment.location;
	const history = environment.history;
	const callbackFragmentStore = environment.callbackFragmentStore;
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

export interface CaptureBackendOidcModePageCallbackFragmentOptions {
	environment?: BackendOidcModePageCallbackCapability;
}

export async function captureBackendOidcModePageCallbackFragment(
	options: CaptureBackendOidcModePageCallbackFragmentOptions = {},
): Promise<string | null> {
	return captureBackendOidcModeCallbackFragment({
		environment: assertResolveEnvironment(
			options.environment,
			failMissingBackendOidcPageCallbackEnvironment,
		),
	});
}

export interface BootstrapBackendOidcModePageClientOptions {
	environment?: BackendOidcModePageCallbackCapability;
}

export async function bootstrapBackendOidcModePageClient(
	client: BackendOidcModeClient,
	options: BootstrapBackendOidcModePageClientOptions = {},
): Promise<BackendOidcModeBootstrapResult> {
	const environment = assertResolveEnvironment(
		options.environment,
		failMissingBackendOidcPageCallbackEnvironment,
	);

	await captureBackendOidcModePageCallbackFragment({
		environment,
	});

	return bootstrapBackendOidcModeFromCallbackStore(
		client,
		environment.callbackFragmentStore,
	);
}

export async function restoreBackendOidcModeClient(
	client: BackendOidcModeClient,
): Promise<BackendOidcModeBootstrapResult> {
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

export async function bootstrapBackendOidcModeFromCallbackStore(
	client: BackendOidcModeClient,
	callbackFragmentStore: EphemeralFlowStore<string>,
): Promise<BackendOidcModeBootstrapResult> {
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

	return restoreBackendOidcModeClient(client);
}

/**
 * Build an authorize URL that returns the user to the current page.
 *
 * Convenience wrapper: extracts `window.location.href` (minus hash) as the
 * `post_auth_redirect_uri` and appends it to the client's authorize URL.
 * If the redirect target is known statically, prefer `client.authorizeUrl()`
 * with an explicit path instead.
 */
export interface BuildAuthorizeUrlReturningToCurrentPageOptions {
	environment?: BackendOidcModePageLocationCapability;
}

export function buildAuthorizeUrlReturningToCurrentPage(
	client: BackendOidcModeClient,
	options: BuildAuthorizeUrlReturningToCurrentPageOptions = {},
): string {
	return client.authorizeUrl(currentPageLocationAsPostAuthRedirectUri(options));
}

function redirectToBackendOidcLogin(
	client: BackendOidcModeClient,
	options: {
		environment: BackendOidcModePageLocationCapability;
		postAuthRedirectUri: string;
	},
): void {
	options.environment.location.href = client.authorizeUrl(
		options.postAuthRedirectUri,
	);
}

/**
 * Options for the compatibility wrapper {@link loginWithBackendOidcRedirect}.
 */
export interface LoginWithBackendOidcRedirectOptions
	extends Omit<OidcRedirectLoginOptions, "environment"> {
	/**
	 * Where to redirect the user after successful authentication.
	 *
	 * When omitted, the current `window.location.href` (minus the hash) is
	 * used as the return URI.
	 */
	postAuthRedirectUri?: string;
	/** Override the page environment used to derive the default return URI. */
	environment?: BackendOidcModePageLocationCapability;
}

/**
 * Compatibility/convenience wrapper around the shared
 * `OidcRedirectLoginClient.loginWithRedirect()` contract.
 *
 * New framework adapters and registry-managed clients should prefer the
 * shared `loginWithRedirect({ environment, postAuthRedirectUri })` surface.
 * This helper remains available for existing backend-oidc callers that want
 * the same browser redirect behavior without first materializing that shared
 * client contract.
 */
export function loginWithBackendOidcRedirect(
	client: BackendOidcModeClient,
	options: LoginWithBackendOidcRedirectOptions = {},
): void {
	const environment = assertResolveEnvironment(
		options.environment,
		failMissingBackendOidcPageEnvironment,
	);
	const postAuthRedirectUri =
		options.postAuthRedirectUri ??
		currentPageLocationAsPostAuthRedirectUri({ environment });

	redirectToBackendOidcLogin(client, {
		environment,
		postAuthRedirectUri,
	});
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
	/** Override the popup login environment, including callback fragment store. */
	environment: BackendOidcModePopupLoginCapability;
}

/**
 * Initiate backend-oidc login via a popup window.
 *
 * Opens a popup to the backend OIDC authorize URL, waits for the popup
 * callback page to relay the result back via `postMessage`, then processes
 * the callback fragment through the existing bootstrap pipeline.
 *
 * The callback fragment store is supplied by the host composition root through
 * `environment`; this helper does not create browser storage defaults.
 *
 * @returns The bootstrap result from processing the callback.
 */
export async function loginWithBackendOidcPopup(
	client: BackendOidcModeClient,
	options: LoginWithBackendOidcPopupOptions,
): Promise<BackendOidcModeBootstrapResult> {
	const environment = assertResolveEnvironment(
		options?.environment,
		failMissingBackendOidcCallbackFragmentStore,
	);
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

	const fragmentStore = environment.callbackFragmentStore;
	await fragmentStore.save(hash.slice(1));

	return bootstrapBackendOidcModeFromCallbackStore(client, fragmentStore);
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
export interface RelayBackendOidcPopupCallbackOptions {
	targetOrigin?: string;
	environment?: BackendOidcModePageLocationCapability;
}

export function relayBackendOidcPopupCallback(
	options: RelayBackendOidcPopupCallbackOptions = {},
): void {
	const environment = assertResolveEnvironment(
		options.environment,
		failMissingBackendOidcPageEnvironment,
	);
	relayPopupCallback({
		payload: environment.location.href,
		targetOrigin: options?.targetOrigin,
	});
}

/**
 * Clear all browser-side auth state: persisted auth snapshot and any pending
 * callback fragment.
 *
 * The callback fragment store must be explicit. For same-origin
 * multi-integration scenarios, construct it at the host composition root with
 * {@link createBackendOidcModeCallbackFragmentStore} and a namespaced key from
 * {@link resolveBackendOidcModeCallbackFragmentKey}.
 */
export interface ResetBackendOidcModeBrowserStateOptions {
	callbackFragmentStore: EphemeralFlowStore<string>;
}

export async function resetBackendOidcModeBrowserState(
	client: BackendOidcModeClient,
	options: ResetBackendOidcModeBrowserStateOptions,
): Promise<void> {
	const callbackFragmentStore = options?.callbackFragmentStore;
	if (!callbackFragmentStore) {
		failMissingBackendOidcCallbackFragmentStore();
	}

	await callbackFragmentStore.clear();
	await client.clearState();
}

function failMissingBackendOidcPageEnvironment(): never {
	throw new Error(BACKEND_OIDC_PAGE_ENVIRONMENT_ERROR_MESSAGE);
}

function failMissingBackendOidcPageCallbackEnvironment(): never {
	throw new Error(BACKEND_OIDC_PAGE_CALLBACK_ENVIRONMENT_ERROR_MESSAGE);
}

function failMissingBackendOidcCallbackFragmentStore(): never {
	throw new Error(BACKEND_OIDC_CALLBACK_FRAGMENT_STORE_ERROR_MESSAGE);
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
