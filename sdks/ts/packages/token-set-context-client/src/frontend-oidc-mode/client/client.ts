// Frontend OIDC Mode Client — full lifecycle management
//
// Extends BaseOidcModeClient with browser-side OIDC protocol operations:
//   - OIDC discovery (with optional periodic refresh)
//   - Authorization URL construction + pending state storage
//   - Callback processing + code exchange
//   - Automatic userInfo fetch + claims check
//   - Token refresh via refresh_token grant
//
// High-level API (recommended):
//   authorizeUrl()        — build login URL + store pending state
//   handleCallback()      — restore pending → exchange → userInfo → claimsCheck → persist
//   refresh()             — refresh tokens → optional re-claimsCheck → persist
//   fetchUserInfo()       — fetch userInfo + claimsCheck using current auth state
//   + inherited: restorePersistedState / restoreState / clearState / dispose
//
// Low-level API (for custom flows):
//   discover()            — fetch OIDC discovery document
//   buildAuthorizeUrl()   — build authorization URL (returns PKCE params)
//   exchangeCode()        — exchange authorization code for tokens
//   refreshTokens()       — refresh tokens using refresh_token grant
//   fetchUserInfoRaw()    — fetch raw userInfo from provider
//   checkClaims()         — run claims check script or default logic
//
// Stability: provisional (mode-aligned surface)

import {
	type CancellationTokenOptions,
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	createKeyedEphemeralFlowStore,
	createLinkedCancellationToken,
	decodeJwtPayload,
	defineInstrumentMethodDecorator,
	type EventSubscriptionTrait,
	type FoundationEnvironment,
	injectDisposableStackFrom,
	isLoopbackHttpUrl,
	type KeyedEphemeralFlowStore,
	type OperationSpanTrait,
	parseDurationToMs,
	parseIdentityPrincipal,
	RouterNavigationIntent,
	RouterNavigationMode,
	type SpanTrait,
	UriReferenceString,
	UserRecovery,
	withDisposableStack,
} from "@securitydept/client";
import { createAsyncSchedulerWithTimestampProvider } from "@securitydept/client/rx";
import {
	type AuthorizationServer,
	allowInsecureRequests,
	authorizationCodeGrantRequest,
	type Client,
	None as ClientNone,
	ClientSecretPost,
	calculatePKCECodeChallenge,
	discoveryRequest,
	generateRandomCodeVerifier,
	generateRandomState,
	nopkce,
	processAuthorizationCodeResponse,
	processDiscoveryResponse,
	processRefreshTokenResponse,
	processUserInfoResponse,
	ResponseBodyError,
	refreshTokenGrantRequest,
	type TokenEndpointResponse,
	userInfoRequest,
	validateAuthResponse,
	WWWAuthenticateChallengeError,
} from "oauth4webapi";
import { interval, takeUntil } from "rxjs";
import { waitForTokenSetPopupRelay } from "../../orchestration/client/popup/relay";
import {
	BaseOidcModeClient,
	TokenSetAuthorizationRevocationError,
	TokenSetAuthorizationRevocationReason,
	type TokenSetOidcPopupLoginOptions,
	type TokenSetOidcPopupLoginResult,
	type TokenSetOidcRedirectLoginOptions,
} from "../../orchestration/index";
import {
	type TokenSetAuthMetadataSnapshot,
	type TokenSetAuthSnapshot,
} from "../../orchestration/token/types";
import {
	type FrontendOidcModeClaimsCheckResult,
	type FrontendOidcModeClaimsCheckScript,
	type FrontendOidcModeUserInfoResponse,
} from "../contracts/contracts";
import { transformScriptForBrowser } from "../contracts/script-compat";
import { FrontendOidcModeCallbackErrorCode } from "../errors/callback-error-codes";
import { resolveDiscoveryIssuerCompatibility } from "./discovery";
import {
	FrontendOidcModeErrorCode,
	FrontendOidcModeErrorSource,
} from "./error-codes";
import {
	FrontendOidcModeOperationEventName,
	FrontendOidcModeTraceEventType,
	FrontendOidcModeTraceOperationName,
} from "./trace-events";
import {
	type FrontendOidcModeAuthorizeResult,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeCheckClaimsOptions,
	type FrontendOidcModeClientConfig,
	type FrontendOidcModeClientDefaultOptions,
	FrontendOidcModeContextSource,
	type FrontendOidcModeExchangeCodeOptions,
	type FrontendOidcModePendingState,
	type FrontendOidcModeTokenResult,
	type ResolvedFrontendOidcModeClientConfig,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRACE_TARGET = "frontend-oidc-mode";
const TRACE_PREFIX = "frontend_oidc";

type FrontendOperationFields =
	| Record<string, unknown>
	| ((this: FrontendOidcModeClient) => Record<string, unknown> | undefined);

const instrumentFrontendMethod = defineInstrumentMethodDecorator<
	[name: string, fields?: FrontendOperationFields],
	FrontendOidcModeClient
>(
	({ factoryArgs: [name, fields] }) =>
		function (this: FrontendOidcModeClient) {
			return {
				environment: this.environment,
				span: this.span,
				name,
				target: TRACE_TARGET,
				fields: typeof fields === "function" ? fields.call(this) : fields,
				normalizeError: (error: unknown) =>
					ClientError.fromUnknown(error, {
						code: FrontendOidcModeErrorCode.OperationFailed,
						message: "The frontend OIDC operation failed unexpectedly",
						source: TRACE_TARGET,
					}),
			};
		},
);

interface FrontendOidcModeConsumedState {
	consumedAt: number;
}

interface FrontendOidcModeClaimsCheckScriptResult {
	success?: boolean;
	display_name?: string;
	displayName?: string;
	picture?: string;
	claims?: Record<string, unknown>;
	error?: string;
}

type PendingStateTakeResult =
	| { kind: "taken"; pending: FrontendOidcModePendingState }
	| { kind: "missing" }
	| { kind: "duplicate" }
	| { kind: "stale"; pending: FrontendOidcModePendingState };

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// FrontendOidcModeClient
// ---------------------------------------------------------------------------

/**
 * Browser-side OIDC client for frontend-oidc mode.
 *
 * Extends {@link BaseOidcModeClient} with OIDC discovery, authorization code
 * + PKCE flow, automatic userInfo + claims check, and metadata refresh.
 */
export class FrontendOidcModeClient extends BaseOidcModeClient {
	static override defaultOptions = {
		...BaseOidcModeClient.defaultOptions,
		persistenceKeyPrefix: "securitydept.frontend_oidc",
		pendingStateKeyPrefix: "securitydept.frontend_oidc.pending",
		consumedStateKeyPrefix: "securitydept.frontend_oidc.consumed",
		pendingStateTtlMs: 10 * 60 * 1000,
		consumedStateTtlMs: 10 * 60 * 1000,
	} as const satisfies FrontendOidcModeClientDefaultOptions;

	static resolveDefaultPersistenceKey(
		config: Pick<FrontendOidcModeClientConfig, "issuer" | "clientId">,
	): string {
		return `${FrontendOidcModeClient.defaultOptions.persistenceKeyPrefix}:v1:${config.issuer}:${config.clientId}`;
	}

	// --- Config ---
	private readonly _config: ResolvedFrontendOidcModeClientConfig;

	// --- oauth4webapi ---
	private readonly _o4wClient: Client;
	private readonly _clientAuth: ReturnType<
		typeof ClientSecretPost | typeof ClientNone
	>;
	private _authServer: AuthorizationServer | null = null;

	// --- Pending state ---
	private _pendingStore: KeyedEphemeralFlowStore<FrontendOidcModePendingState> | null =
		null;
	private _consumedStateStore: KeyedEphemeralFlowStore<FrontendOidcModeConsumedState> | null =
		null;

	// --- Metadata refresh ---
	private _metadataRefreshHandle: EventSubscriptionTrait | null = null;

	constructor(
		config: FrontendOidcModeClientConfig,
		environment: FoundationEnvironment,
	) {
		super({
			environment,
			tracing: {
				target: TRACE_TARGET,
				prefix: TRACE_PREFIX,
			},
			id: config.id,
			autoStart: config.autoStart,
			refresh: config.refresh,
			persistence: environment.persistentStorage
				? {
						store: environment.persistentStorage,
						key:
							config.persistence?.key ??
							FrontendOidcModeClient.resolveDefaultPersistenceKey(config),
					}
				: undefined,
		});

		this._config = {
			...config,
			scopes: config.scopes ?? ["openid"],
			pkceEnabled: config.pkceEnabled ?? true,
		};

		this._o4wClient = { client_id: config.clientId };
		this._clientAuth = config.clientSecret
			? ClientSecretPost(config.clientSecret)
			: ClientNone();

		if (environment.sessionStorage) {
			this._pendingStore =
				createKeyedEphemeralFlowStore<FrontendOidcModePendingState>({
					store: environment.sessionStorage,
					keyPrefix:
						FrontendOidcModeClient.defaultOptions.pendingStateKeyPrefix,
				});
			this._consumedStateStore =
				createKeyedEphemeralFlowStore<FrontendOidcModeConsumedState>({
					store: environment.sessionStorage,
					keyPrefix:
						FrontendOidcModeClient.defaultOptions.consumedStateKeyPrefix,
				});
		}
	}

	/** The resolved configuration. */
	get config(): Readonly<ResolvedFrontendOidcModeClientConfig> {
		return this._config;
	}

	/** Subclass dispose hook — cancel metadata refresh timer. */
	protected override _onDispose(): void {
		this._cancelMetadataRefresh();
	}

	// =======================================================================
	// HIGH-LEVEL API
	// =======================================================================

	/**
	 * Build the authorize URL, generate PKCE + nonce, and store pending state.
	 *
	 * The consumer should redirect the browser to the returned URL.
	 * On the callback page, call `handleCallback(callbackUrl)`.
	 */
	@withDisposableStack(0, true)
	async authorizeUrl(
		options: TokenSetOidcRedirectLoginOptions = {},
	): Promise<string> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._authorizeUrlWithState(
			{ postAuthRedirectUri: options.postAuthRedirectUri },
			cancellationToken,
		);
	}

	@instrumentFrontendMethod(FrontendOidcModeTraceOperationName.Authorize)
	private async _authorizeUrlWithState(
		options: {
			postAuthRedirectUri?: string;
			redirectUri?: string;
		},
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<string> {
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.setAttributes({
			hasPostAuthRedirectUri:
				options.postAuthRedirectUri !== undefined ||
				this._config.defaultPostAuthRedirectUri !== undefined,
		});

		await this._ensureAuthServer(cancellationToken, operationSpan);
		cancellationToken.throwIfCancellationRequested();

		const effectiveRedirectUri =
			options.redirectUri ?? this._config.redirectUri;
		const result = await this._buildAuthorizeUrl(
			{ redirectUri: effectiveRedirectUri },
			cancellationToken,
		);
		cancellationToken.throwIfCancellationRequested();

		const effectivePostAuthRedirectUri =
			options.postAuthRedirectUri ?? this._config.defaultPostAuthRedirectUri;

		await this._savePendingState({
			codeVerifier: result.codeVerifier,
			state: result.state,
			contextSource: FrontendOidcModeContextSource.Client,
			issuer: this._config.issuer,
			clientId: this._config.clientId,
			redirectUri: effectiveRedirectUri,
			nonce: result.nonce,
			postAuthRedirectUri: effectivePostAuthRedirectUri,
			createdAt: this._environment.time.now(),
		});
		cancellationToken.throwIfCancellationRequested();

		operationSpan?.setAttributes({ state: result.state });
		return result.redirectUrl;
	}

	/**
	 * One-shot browser redirect to the OIDC provider's authorization endpoint.
	 *
	 * Builds the authorize URL (including PKCE + nonce), stores pending state,
	 * and navigates the current window.  This is the recommended entry point
	 * for initiating frontend-oidc login in a browser context.
	 */
	@withDisposableStack(0, true)
	async loginWithRedirect(
		options: TokenSetOidcRedirectLoginOptions = {},
	): Promise<void> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._loginWithRedirect(options, cancellationToken);
	}

	@instrumentFrontendMethod(FrontendOidcModeTraceOperationName.LoginRedirect)
	private async _loginWithRedirect(
		options: TokenSetOidcRedirectLoginOptions,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<void> {
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.setAttributes({
			hasPostAuthRedirectUri: options.postAuthRedirectUri !== undefined,
		});
		const router = this._environment.router;
		if (!router) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: FrontendOidcModeErrorCode.RedirectRouterUnavailable,
				message: "Frontend OIDC redirect login requires environment.router.",
				source: TRACE_TARGET,
			});
		}
		const url = await this._authorizeUrlWithState(
			{ postAuthRedirectUri: options.postAuthRedirectUri },
			cancellationToken,
		);
		cancellationToken.throwIfCancellationRequested();

		await router.navigate({
			url: UriReferenceString.parse(url),
			intent: RouterNavigationIntent.AuthRedirect,
			mode: RouterNavigationMode.External,
		});
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.setAttributes({ navigationMode: "external" });
	}

	/**
	 * Initiate frontend-oidc login via a popup window.
	 *
	 * Opens a popup to the OIDC provider's authorization endpoint, waits for
	 * the popup callback page to relay the callback URL back via `postMessage`,
	 * then processes the callback through the existing `handleCallback()` pipeline.
	 *
	 * @returns The callback result from processing the authorization code.
	 */
	@withDisposableStack(0, true)
	@instrumentFrontendMethod(FrontendOidcModeTraceOperationName.LoginPopup)
	async loginWithPopup(
		options: TokenSetOidcPopupLoginOptions,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetOidcPopupLoginResult> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.setAttributes({
			popupCallbackUrl: options.popupCallbackUrl,
		});
		const popupCapability = this._environment.popup;
		if (!popupCapability) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: FrontendOidcModeErrorCode.PopupCapabilityMissing,
				message:
					"Frontend OIDC popup login requires environment.popup capability.",
				source: TRACE_TARGET,
				recovery: UserRecovery.RestartFlow,
			});
		}
		const popupAuthorizeUrl = await this._authorizeUrlWithState(
			{ redirectUri: options.popupCallbackUrl },
			cancellationToken,
		);
		cancellationToken.throwIfCancellationRequested();

		const popupHandle = popupCapability.open(popupAuthorizeUrl, {
			expectedOrigin: new URL(
				options.popupCallbackUrl,
				this._config.redirectUri,
			).origin,
			width: options.popupWidth,
			height: options.popupHeight,
		});
		operationSpan?.addEvent(FrontendOidcModeOperationEventName.PopupOpened, {
			popupCallbackUrl: options.popupCallbackUrl,
		});

		const callbackUrl = await waitForTokenSetPopupRelay({
			popup: popupHandle,
			time: this._environment.time,
			timeoutMs: options.timeoutMs,
			cancellationToken,
		});
		cancellationToken.throwIfCancellationRequested();

		operationSpan?.addEvent(
			FrontendOidcModeOperationEventName.PopupRelaySucceeded,
			{
				popupCallbackUrl: options.popupCallbackUrl,
			},
		);

		const result = await this._handleCallbackOperation(
			callbackUrl,
			cancellationToken,
		);
		cancellationToken.throwIfCancellationRequested();
		return { snapshot: result.snapshot };
	}

	/**
	 * Handle a callback URL from the provider redirect.
	 *
	 * Restores pending state, exchanges code, fetches userInfo,
	 * runs claims check, persists snapshot, and schedules refresh.
	 */
	@withDisposableStack(1, true)
	async handleCallback(
		callbackUrl: string,
		options: CancellationTokenOptions = {},
	): Promise<FrontendOidcModeCallbackResult> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._handleCallbackOperation(callbackUrl, cancellationToken);
	}

	@instrumentFrontendMethod(FrontendOidcModeTraceOperationName.Callback, {
		flow: "callback",
	})
	private async _handleCallbackOperation(
		callbackUrl: string,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<FrontendOidcModeCallbackResult> {
		cancellationToken.throwIfCancellationRequested();

		const url = new URL(callbackUrl);
		const state = url.searchParams.get("state");
		if (!state) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				message: "Callback URL missing state parameter",
				code: FrontendOidcModeCallbackErrorCode.MissingState,
				recovery: UserRecovery.RestartFlow,
				source: TRACE_TARGET,
			});
		}

		const pendingResult = await this._takePendingState(state);
		if (pendingResult.kind === "missing") {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				message:
					"No pending authorization state exists for this callback state",
				code: FrontendOidcModeCallbackErrorCode.UnknownState,
				recovery: UserRecovery.RestartFlow,
				source: TRACE_TARGET,
			});
		}

		if (pendingResult.kind === "duplicate") {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				message: "This callback state has already been consumed",
				code: FrontendOidcModeCallbackErrorCode.DuplicateState,
				recovery: UserRecovery.RestartFlow,
				source: TRACE_TARGET,
			});
		}

		if (pendingResult.kind === "stale") {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				message: "Pending authorization state expired before callback",
				code: FrontendOidcModeCallbackErrorCode.PendingStale,
				recovery: UserRecovery.RestartFlow,
				source: TRACE_TARGET,
			});
		}

		const pending = pendingResult.pending;
		if (
			pending.contextSource !== FrontendOidcModeContextSource.Client ||
			pending.issuer !== this._config.issuer ||
			pending.clientId !== this._config.clientId
		) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				message:
					"Pending authorization state does not belong to this frontend OIDC client",
				code: FrontendOidcModeCallbackErrorCode.PendingClientMismatch,
				recovery: UserRecovery.RestartFlow,
				source: TRACE_TARGET,
			});
		}

		cancellationToken.throwIfCancellationRequested();

		await this._ensureAuthServer(cancellationToken, operationSpan);
		cancellationToken.throwIfCancellationRequested();
		const tokens = await this._exchangeCode(
			callbackUrl,
			pending.codeVerifier,
			pending.state,
			pending.redirectUri,
			cancellationToken,
			pending.nonce,
		);

		cancellationToken.throwIfCancellationRequested();

		const metadata = await this._performClaimsCheck(
			tokens,
			cancellationToken,
			operationSpan ?? this.span,
		);
		cancellationToken.throwIfCancellationRequested();

		const snapshot: TokenSetAuthSnapshot = {
			tokens: this._tokenResultToTokenSnapshot(tokens),
			metadata,
		};

		await this._applySnapshot(snapshot, {}, cancellationToken, operationSpan);
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.setAttributes({
			hasClaimsCheck: metadata.principal !== undefined,
			persisted: this._persistence !== null,
		});

		return {
			snapshot,
			postAuthRedirectUri: pending.postAuthRedirectUri,
		};
	}

	/**
	 * Refresh the current token set.
	 *
	 * If the refresh response contains a new id_token, userInfo is re-fetched
	 * and claims check is re-run. Otherwise, existing metadata is preserved.
	 */
	protected async _refreshAuthSnapshot(
		current: TokenSetAuthSnapshot,
		_freshnessTiming: unknown,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot | null> {
		if (!current.tokens.refreshMaterial) {
			return null;
		}
		const refreshMaterial = current.tokens.refreshMaterial;

		cancellationToken.throwIfCancellationRequested();

		await this._ensureAuthServer(cancellationToken, operationSpan);
		cancellationToken.throwIfCancellationRequested();
		let tokens: FrontendOidcModeTokenResult;
		try {
			tokens = await this._refreshTokens(refreshMaterial, cancellationToken);
		} catch (error) {
			if (
				error instanceof ResponseBodyError &&
				error.error === TokenSetAuthorizationRevocationReason.InvalidGrant
			) {
				throw new TokenSetAuthorizationRevocationError({
					reason: TokenSetAuthorizationRevocationReason.InvalidGrant,
					cause: error,
				});
			}
			if (
				error instanceof WWWAuthenticateChallengeError &&
				error.status === 401 &&
				error.cause.some(
					(challenge) =>
						challenge.scheme === "bearer" &&
						challenge.parameters.error ===
							TokenSetAuthorizationRevocationReason.InvalidToken,
				)
			) {
				throw new TokenSetAuthorizationRevocationError({
					reason: TokenSetAuthorizationRevocationReason.InvalidToken,
					cause: error,
				});
			}
			throw error;
		}

		cancellationToken.throwIfCancellationRequested();

		let metadata: TokenSetAuthMetadataSnapshot;
		if (tokens.idToken) {
			metadata = await this._performClaimsCheck(
				tokens,
				cancellationToken,
				operationSpan ?? this.span,
			);
			cancellationToken.throwIfCancellationRequested();
		} else {
			metadata = current.metadata;
		}

		const newSnapshot: TokenSetAuthSnapshot = {
			tokens: this._tokenResultToTokenSnapshot(
				tokens,
				current.tokens.refreshMaterial,
			),
			metadata,
		};

		operationSpan?.setAttributes({
			newIdToken: tokens.idToken !== undefined,
			persisted: this._persistence !== null,
		});

		return newSnapshot;
	}

	/**
	 * Fetch userInfo using the current auth state and run claims check.
	 */
	@withDisposableStack(0, true)
	async fetchUserInfo(
		options: CancellationTokenOptions = {},
	): Promise<FrontendOidcModeClaimsCheckResult> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._fetchUserInfoFromCurrentState(cancellationToken);
	}

	@instrumentFrontendMethod(FrontendOidcModeTraceOperationName.UserInfo)
	private async _fetchUserInfoFromCurrentState(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<FrontendOidcModeClaimsCheckResult> {
		cancellationToken.throwIfCancellationRequested();

		const current = this._readAuthSnapshotValue();
		operationSpan?.setAttributes({
			hasAccessToken: current?.tokens.accessToken !== undefined,
			hasIdToken: current?.tokens.idToken !== undefined,
		});
		if (!current?.tokens.accessToken || !current.tokens.idToken) {
			throw new ClientError({
				kind: ClientErrorKind.Unauthenticated,
				message: "Cannot fetch user info without access_token and id_token",
				code: FrontendOidcModeErrorCode.UserInfoUnauthenticated,
				source: TRACE_TARGET,
			});
		}

		await this._ensureAuthServer(cancellationToken, operationSpan);
		cancellationToken.throwIfCancellationRequested();
		const userInfo = await this._fetchUserInfoRaw(
			current.tokens.accessToken,
			cancellationToken,
		);
		cancellationToken.throwIfCancellationRequested();
		const result = await this._checkClaims(
			current.tokens.idToken,
			cancellationToken,
			userInfo.claims,
		);
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.setAttributes({ hasClaimsCheck: true });
		return result;
	}

	// =======================================================================
	// LOW-LEVEL PROTOCOL API
	// =======================================================================

	/** Fetch and cache the provider's OpenID discovery document. */
	@withDisposableStack(0, true)
	async discover(options: CancellationTokenOptions = {}): Promise<void> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		await this._discover(cancellationToken);
	}

	private async _discover(
		cancellationToken: CancellationTokenTrait,
		span?: SpanTrait,
	): Promise<void> {
		cancellationToken.throwIfCancellationRequested();
		const configuredIssuer = this._config.issuer;
		const configuredIssuerUrl = new URL(configuredIssuer);
		const response = await discoveryRequest(
			configuredIssuerUrl,
			this._oauthRequestOptions(),
		);
		cancellationToken.throwIfCancellationRequested();
		const compatibleIssuer = await resolveDiscoveryIssuerCompatibility(
			response,
			configuredIssuer,
		);
		cancellationToken.throwIfCancellationRequested();
		const compatibleIssuerUrl = new URL(compatibleIssuer);
		const discovered = await processDiscoveryResponse(
			compatibleIssuerUrl,
			response,
		);
		cancellationToken.throwIfCancellationRequested();
		this._authServer = this._applyEndpointOverrides(discovered);
		this._scheduleMetadataRefresh();

		if (compatibleIssuer !== configuredIssuer) {
			this._recordTrace(
				FrontendOidcModeTraceEventType.DiscoveryIssuerCompatResolved,
				{
					configuredIssuer,
					resolvedIssuer: compatibleIssuer,
				},
				span ?? this.span,
			);
		}
	}

	/** Build an authorization URL with PKCE + nonce (low-level). */
	@withDisposableStack(0, true)
	async buildAuthorizeUrl(
		options: CancellationTokenOptions = {},
	): Promise<FrontendOidcModeAuthorizeResult> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._buildAuthorizeUrl(
			{ redirectUri: this._config.redirectUri },
			cancellationToken,
		);
	}

	private async _buildAuthorizeUrl(
		options: { redirectUri: string },
		cancellationToken: CancellationTokenTrait,
	): Promise<FrontendOidcModeAuthorizeResult> {
		cancellationToken.throwIfCancellationRequested();
		const authServer = this._requireAuthServer("buildAuthorizeUrl");
		if (!authServer.authorization_endpoint) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: FrontendOidcModeErrorCode.AuthorizationEndpointMissing,
				message:
					"The OIDC authorization server metadata does not provide an authorization endpoint",
				source: FrontendOidcModeErrorSource.Discovery,
			});
		}

		const state = generateRandomState();
		const nonce = generateRandomState();
		const authUrl = new URL(authServer.authorization_endpoint);
		authUrl.searchParams.set("client_id", this._config.clientId);
		authUrl.searchParams.set("redirect_uri", options.redirectUri);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("scope", this._config.scopes.join(" "));
		authUrl.searchParams.set("state", state);
		authUrl.searchParams.set("nonce", nonce);

		let codeVerifier: string | undefined;
		if (this._config.pkceEnabled) {
			codeVerifier = generateRandomCodeVerifier();
			const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
			cancellationToken.throwIfCancellationRequested();
			authUrl.searchParams.set("code_challenge", codeChallenge);
			authUrl.searchParams.set("code_challenge_method", "S256");
		}

		return { redirectUrl: authUrl.toString(), codeVerifier, state, nonce };
	}

	/** Exchange an authorization code for tokens (low-level). */
	@withDisposableStack(4, true)
	async exchangeCode(
		callbackUrl: string,
		codeVerifier: string | undefined,
		state: string,
		redirectUri: string,
		options: FrontendOidcModeExchangeCodeOptions = {},
	): Promise<FrontendOidcModeTokenResult> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._exchangeCode(
			callbackUrl,
			codeVerifier,
			state,
			redirectUri,
			cancellationToken,
			options.expectedNonce,
		);
	}

	private async _exchangeCode(
		callbackUrl: string,
		codeVerifier: string | undefined,
		state: string,
		redirectUri: string,
		cancellationToken: CancellationTokenTrait,
		expectedNonce?: string,
	): Promise<FrontendOidcModeTokenResult> {
		cancellationToken.throwIfCancellationRequested();
		const authServer = this._requireAuthServer("exchangeCode");

		const currentUrl = new URL(callbackUrl);
		const params = validateAuthResponse(
			authServer,
			this._o4wClient,
			currentUrl,
			state,
		);

		const response = await authorizationCodeGrantRequest(
			authServer,
			this._o4wClient,
			this._clientAuth,
			params,
			redirectUri,
			this._config.pkceEnabled ? (codeVerifier ?? nopkce) : nopkce,
			this._oauthRequestOptions(),
		);
		cancellationToken.throwIfCancellationRequested();

		const result = await processAuthorizationCodeResponse(
			authServer,
			this._o4wClient,
			response,
			expectedNonce ? { expectedNonce } : undefined,
		);
		cancellationToken.throwIfCancellationRequested();

		const tokenResult = this._normalizeTokenResponse(result);
		this._validateRequiredScopes(tokenResult.grantedScopes);
		return tokenResult;
	}

	/** Refresh tokens using a refresh_token grant (low-level). */
	@withDisposableStack(1, true)
	async refreshTokens(
		refreshToken: string,
		options: CancellationTokenOptions = {},
	): Promise<FrontendOidcModeTokenResult> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._refreshTokens(refreshToken, cancellationToken);
	}

	private async _refreshTokens(
		refreshToken: string,
		cancellationToken: CancellationTokenTrait,
	): Promise<FrontendOidcModeTokenResult> {
		cancellationToken.throwIfCancellationRequested();
		const authServer = this._requireAuthServer("refreshTokens");

		const response = await refreshTokenGrantRequest(
			authServer,
			this._o4wClient,
			this._clientAuth,
			refreshToken,
			this._oauthRequestOptions(),
		);
		cancellationToken.throwIfCancellationRequested();

		const result = await processRefreshTokenResponse(
			authServer,
			this._o4wClient,
			response,
		);
		cancellationToken.throwIfCancellationRequested();

		return this._normalizeTokenResponse(result);
	}

	/** Fetch raw userInfo from the provider (low-level). */
	@withDisposableStack(1, true)
	async fetchUserInfoRaw(
		accessToken: string,
		options: CancellationTokenOptions = {},
	): Promise<FrontendOidcModeUserInfoResponse> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._fetchUserInfoRaw(accessToken, cancellationToken);
	}

	private async _fetchUserInfoRaw(
		accessToken: string,
		cancellationToken: CancellationTokenTrait,
	): Promise<FrontendOidcModeUserInfoResponse> {
		cancellationToken.throwIfCancellationRequested();
		const authServer = this._requireAuthServer("fetchUserInfoRaw");

		const response = await userInfoRequest(
			authServer,
			this._o4wClient,
			accessToken,
			this._oauthRequestOptions(),
		);
		cancellationToken.throwIfCancellationRequested();

		const claims = await processUserInfoResponse(
			authServer,
			this._o4wClient,
			undefined as unknown as string,
			response,
		);
		cancellationToken.throwIfCancellationRequested();
		const principal = parseIdentityPrincipal({
			subject: claims.sub,
			displayName: claims.name,
			picture: claims.picture,
			claims: claims as Record<string, unknown>,
		});

		return {
			...principal,
			email: typeof claims.email === "string" ? claims.email : undefined,
			emailVerified:
				typeof claims.email_verified === "boolean"
					? claims.email_verified
					: undefined,
			claims: claims as Record<string, unknown>,
		};
	}

	/** Run claims check script or default logic (low-level). */
	@withDisposableStack(1, true)
	async checkClaims(
		idToken: string,
		options: FrontendOidcModeCheckClaimsOptions = {},
	): Promise<FrontendOidcModeClaimsCheckResult> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._checkClaims(
			idToken,
			cancellationToken,
			options.userInfoClaims,
		);
	}

	private async _checkClaims(
		idToken: string,
		cancellationToken: CancellationTokenTrait,
		userInfoClaims?: Record<string, unknown> | null,
	): Promise<FrontendOidcModeClaimsCheckResult> {
		cancellationToken.throwIfCancellationRequested();
		const idTokenClaims = decodeJwtPayload(idToken);
		const uiClaims = userInfoClaims ?? null;

		const script = this._config.claimsCheckScript;
		if (script) {
			const result = await this._executeClaimsCheckScript(
				script,
				idTokenClaims,
				uiClaims,
				cancellationToken,
			);
			cancellationToken.throwIfCancellationRequested();
			return result;
		}
		return this._defaultClaimsCheck(idTokenClaims, uiClaims);
	}

	// =======================================================================
	// Private: Auth server management
	// =======================================================================

	private async _ensureAuthServer(
		cancellationToken: CancellationTokenTrait,
		span?: SpanTrait,
	): Promise<void> {
		if (this._authServer) {
			return;
		}
		if (this._canConstructManually()) {
			this._authServer = this._constructManualAuthServer();
			return;
		}
		await this._discover(cancellationToken, span);
		cancellationToken.throwIfCancellationRequested();
	}

	private _canConstructManually(): boolean {
		const c = this._config;
		return !!(c.authorizationEndpoint && c.tokenEndpoint && c.issuer);
	}

	private _constructManualAuthServer(): AuthorizationServer {
		const c = this._config;
		return {
			issuer: c.issuer,
			authorization_endpoint: c.authorizationEndpoint,
			token_endpoint: c.tokenEndpoint,
			...(c.userinfoEndpoint && {
				userinfo_endpoint: c.userinfoEndpoint,
			}),
			...(c.revocationEndpoint && {
				revocation_endpoint: c.revocationEndpoint,
			}),
			...(c.jwksUri && { jwks_uri: c.jwksUri }),
			...(c.tokenEndpointAuthMethodsSupported?.length && {
				token_endpoint_auth_methods_supported:
					c.tokenEndpointAuthMethodsSupported,
			}),
			...(c.idTokenSigningAlgValuesSupported?.length && {
				id_token_signing_alg_values_supported:
					c.idTokenSigningAlgValuesSupported,
			}),
			...(c.userinfoSigningAlgValuesSupported?.length && {
				userinfo_signing_alg_values_supported:
					c.userinfoSigningAlgValuesSupported,
			}),
		};
	}

	private _oauthRequestOptions():
		| { [allowInsecureRequests]: true }
		| undefined {
		const issuerUrl = new URL(this._config.issuer);
		return isLoopbackHttpUrl(issuerUrl)
			? { [allowInsecureRequests]: true }
			: undefined;
	}

	private _requireAuthServer(method: string): AuthorizationServer {
		if (!this._authServer) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: FrontendOidcModeErrorCode.AuthorizationServerUnavailable,
				message: `OIDC authorization server metadata is unavailable before ${method}()`,
				source: FrontendOidcModeErrorSource.Discovery,
			});
		}
		return this._authServer;
	}

	private _applyEndpointOverrides(
		server: AuthorizationServer,
	): AuthorizationServer {
		return {
			...server,
			...(this._config.authorizationEndpoint && {
				authorization_endpoint: this._config.authorizationEndpoint,
			}),
			...(this._config.tokenEndpoint && {
				token_endpoint: this._config.tokenEndpoint,
			}),
			...(this._config.userinfoEndpoint && {
				userinfo_endpoint: this._config.userinfoEndpoint,
			}),
			...(this._config.revocationEndpoint && {
				revocation_endpoint: this._config.revocationEndpoint,
			}),
			...(this._config.tokenEndpointAuthMethodsSupported?.length && {
				token_endpoint_auth_methods_supported:
					this._config.tokenEndpointAuthMethodsSupported,
			}),
			...(this._config.idTokenSigningAlgValuesSupported?.length && {
				id_token_signing_alg_values_supported:
					this._config.idTokenSigningAlgValuesSupported,
			}),
			...(this._config.userinfoSigningAlgValuesSupported?.length && {
				userinfo_signing_alg_values_supported:
					this._config.userinfoSigningAlgValuesSupported,
			}),
		};
	}

	// =======================================================================
	// Private: Token normalization + validation
	// =======================================================================

	private _normalizeTokenResponse(
		result: TokenEndpointResponse,
	): FrontendOidcModeTokenResult {
		const tokenResult: FrontendOidcModeTokenResult = {
			accessToken: result.access_token,
			idToken: result.id_token,
			refreshToken: result.refresh_token,
		};

		if (result.expires_in !== undefined) {
			const expiresAtMs =
				this._environment.time.now() + result.expires_in * 1000;
			tokenResult.expiresAt = new Date(expiresAtMs).toISOString();
		}

		if (typeof result.scope === "string") {
			tokenResult.grantedScopes = result.scope.split(" ");
		}

		return tokenResult;
	}

	private _validateRequiredScopes(grantedScopes: string[] | undefined): void {
		if (!this._config.requiredScopes?.length) {
			return;
		}
		const granted = new Set(grantedScopes ?? []);
		const missing = this._config.requiredScopes.filter((s) => !granted.has(s));
		if (missing.length > 0) {
			throw new ClientError({
				kind: ClientErrorKind.Authorization,
				code: FrontendOidcModeErrorCode.RequiredScopesMissing,
				message: `The token response is missing required scopes: ${missing.join(", ")}`,
				source: FrontendOidcModeErrorSource.Authorization,
			});
		}
	}

	private _tokenResultToTokenSnapshot(
		tokens: FrontendOidcModeTokenResult,
		previousRefreshMaterial?: string,
	) {
		return {
			accessToken: tokens.accessToken,
			idToken: tokens.idToken,
			refreshMaterial: tokens.refreshToken ?? previousRefreshMaterial,
			accessTokenIssuedAt: new Date(this._environment.time.now()).toISOString(),
			accessTokenExpiresAt: tokens.expiresAt,
		};
	}

	// =======================================================================
	// Private: Claims check
	// =======================================================================

	private async _performClaimsCheck(
		tokens: FrontendOidcModeTokenResult,
		cancellationToken: CancellationTokenTrait,
		span: SpanTrait,
	): Promise<TokenSetAuthMetadataSnapshot> {
		if (!tokens.idToken) {
			return {};
		}

		let userInfoClaims: Record<string, unknown> | null = null;
		if (this._authServer?.userinfo_endpoint) {
			try {
				const userInfo = await this._fetchUserInfoRaw(
					tokens.accessToken,
					cancellationToken,
				);
				userInfoClaims = userInfo.claims ?? null;
			} catch (error) {
				cancellationToken.throwIfCancellationRequested();
				this._recordFailureTrace(
					"frontend_oidc.claims_check.user_info_failed",
					error,
					undefined,
					span,
				);
			}
		}

		const claimsResult = await this._checkClaims(
			tokens.idToken,
			cancellationToken,
			userInfoClaims,
		);
		cancellationToken.throwIfCancellationRequested();

		if (!claimsResult.success) {
			throw new ClientError({
				kind: ClientErrorKind.Authorization,
				message: `Claims check failed: ${claimsResult.error ?? "unknown reason"}`,
				code: FrontendOidcModeErrorCode.ClaimsCheckFailed,
				source: TRACE_TARGET,
			});
		}

		const principal = parseIdentityPrincipal({
			subject: decodeJwtPayload(tokens.idToken).sub,
			displayName: claimsResult.displayName,
			picture: claimsResult.picture,
			claims: claimsResult.claims,
		});

		return {
			principal,
			source: {
				kind: "oidc_authorization_code",
				providerId: this._config.issuer,
			},
		};
	}

	private async _executeClaimsCheckScript(
		script: FrontendOidcModeClaimsCheckScript,
		idTokenClaims: Record<string, unknown>,
		userInfoClaims: Record<string, unknown> | null,
		cancellationToken: CancellationTokenTrait,
	): Promise<FrontendOidcModeClaimsCheckResult> {
		cancellationToken.throwIfCancellationRequested();
		if (script.type !== "inline") {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: FrontendOidcModeErrorCode.ClaimsScriptUnsupported,
				message: `Unsupported claims check script type: ${(script as { type: string }).type}`,
				source: FrontendOidcModeErrorSource.Claims,
			});
		}

		const compatScript = transformScriptForBrowser(script.content);

		// eslint-disable-next-line @typescript-eslint/no-implied-eval
		const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
		const fn = new AsyncFunction(
			"__idTokenClaims",
			"__userInfoClaims",
			`
			var __exports = {};
			${compatScript}
			var __fn = __exports.default;
			if (typeof __fn !== 'function') {
				throw new Error('No default export function found in the claims check script');
			}
			return await __fn(__idTokenClaims, __userInfoClaims);
			`,
		);

		let raw: FrontendOidcModeClaimsCheckScriptResult | null;
		try {
			raw = (await fn(
				idTokenClaims,
				userInfoClaims,
			)) as FrontendOidcModeClaimsCheckScriptResult | null;
		} catch (error) {
			throw new ClientError({
				kind: ClientErrorKind.Authorization,
				code: FrontendOidcModeErrorCode.ClaimsScriptFailed,
				message: "The configured claims check script failed",
				source: FrontendOidcModeErrorSource.Claims,
				cause: error,
			});
		}
		cancellationToken.throwIfCancellationRequested();

		if (raw && raw.success === true) {
			return {
				success: true,
				displayName: raw.display_name ?? raw.displayName ?? "",
				picture: raw.picture,
				claims: raw.claims ?? {},
			};
		}
		return {
			success: false,
			error: raw?.error ?? "Claims check script rejected the claims",
			claims: raw?.claims,
		};
	}

	private _defaultClaimsCheck(
		idTokenClaims: Record<string, unknown>,
		userInfoClaims: Record<string, unknown> | null,
	): FrontendOidcModeClaimsCheckResult {
		const displayName =
			this._pickClaim<string>(
				userInfoClaims,
				idTokenClaims,
				"preferred_username",
			) ??
			this._pickClaim<string>(userInfoClaims, idTokenClaims, "nickname") ??
			this._pickClaim<string>(userInfoClaims, idTokenClaims, "sub") ??
			"Unknown";

		const picture = this._pickClaim<string>(
			userInfoClaims,
			idTokenClaims,
			"picture",
		);

		const mergedClaims: Record<string, unknown> = {
			...idTokenClaims,
			...(userInfoClaims ?? {}),
		};

		return { success: true, displayName, picture, claims: mergedClaims };
	}

	private _pickClaim<T>(
		userInfo: Record<string, unknown> | null,
		idToken: Record<string, unknown>,
		key: string,
	): T | undefined {
		const val = (userInfo?.[key] ?? idToken[key]) as T | undefined;
		return val !== undefined && val !== null ? val : undefined;
	}

	// =======================================================================
	// Private: Pending state management (KeyedEphemeralFlowStore)
	// =======================================================================

	private _requirePendingStore(): KeyedEphemeralFlowStore<FrontendOidcModePendingState> {
		if (!this._pendingStore) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"FrontendOidcModeClient requires environment.sessionStorage for redirect-based flows",
				code: FrontendOidcModeErrorCode.SessionStorageUnavailable,
				source: TRACE_TARGET,
			});
		}
		return this._pendingStore;
	}

	private _requireConsumedStateStore(): KeyedEphemeralFlowStore<FrontendOidcModeConsumedState> {
		if (!this._consumedStateStore) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"FrontendOidcModeClient requires environment.sessionStorage for redirect-based flows",
				code: FrontendOidcModeErrorCode.SessionStorageUnavailable,
				source: TRACE_TARGET,
			});
		}
		return this._consumedStateStore;
	}

	private async _savePendingState(
		pending: FrontendOidcModePendingState,
	): Promise<void> {
		await this._clearConsumedState(pending.state);
		await this._requirePendingStore().save(pending.state, pending);
	}

	private async _takePendingState(
		state: string,
	): Promise<PendingStateTakeResult> {
		const pending = await this._requirePendingStore().take(state);
		if (!pending) {
			const consumedState = await this._loadConsumedState(state);
			return consumedState ? { kind: "duplicate" } : { kind: "missing" };
		}

		if (
			this._environment.time.now() - pending.createdAt >
			FrontendOidcModeClient.defaultOptions.pendingStateTtlMs
		) {
			return { kind: "stale", pending };
		}

		await this._markConsumedState(state);
		return { kind: "taken", pending };
	}

	private async _markConsumedState(state: string): Promise<void> {
		await this._requireConsumedStateStore().save(state, {
			consumedAt: this._environment.time.now(),
		});
	}

	private async _loadConsumedState(
		state: string,
	): Promise<FrontendOidcModeConsumedState | null> {
		const consumedState = await this._requireConsumedStateStore().load(state);
		if (!consumedState) {
			return null;
		}

		if (
			this._environment.time.now() - consumedState.consumedAt >
			FrontendOidcModeClient.defaultOptions.consumedStateTtlMs
		) {
			await this._clearConsumedState(state);
			return null;
		}

		return consumedState;
	}

	private async _clearConsumedState(state: string): Promise<void> {
		await this._requireConsumedStateStore().clear(state);
	}

	// =======================================================================
	// Private: Metadata refresh
	// =======================================================================

	private _scheduleMetadataRefresh(): void {
		const intervalStr = this._config.metadataRefreshInterval;
		if (!intervalStr) {
			return;
		}
		const intervalMs = parseDurationToMs(intervalStr);
		if (intervalMs <= 0) {
			return;
		}

		this._cancelMetadataRefresh();

		this._metadataRefreshHandle = interval(
			intervalMs,
			createAsyncSchedulerWithTimestampProvider(this._environment.time),
		)
			.pipe(takeUntil(this.destroyed$))
			.subscribe({
				next: () => {
					const cancellationToken = this._rootCancellation.token;
					this._discover(cancellationToken, this.span)
						.then(() => {
							this._recordTrace(
								FrontendOidcModeTraceEventType.MetadataRefreshed,
								undefined,
								this.span,
							);
						})
						.catch((error) => {
							this._recordFailureTrace(
								FrontendOidcModeTraceEventType.MetadataRefreshFailed,
								error,
								undefined,
								this.span,
							);
						});
				},
			});
	}

	private _cancelMetadataRefresh(): void {
		if (!this._metadataRefreshHandle) {
			return;
		}
		this._metadataRefreshHandle.unsubscribe();
		this._metadataRefreshHandle = null;
	}
}
