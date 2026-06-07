import {
	type CancellationTokenOptions,
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	type CompatFragmentParameters,
	createLinkedCancellationToken,
	defineInstrumentMethodDecorator,
	type FoundationEnvironment,
	type HttpResponseJsonBody,
	injectDisposableStackFrom,
	type OperationSpanTrait,
	parseCompatFragment,
	RouterNavigationIntent,
	RouterNavigationMode,
	UriReferenceString,
	UserRecovery,
	withDisposableStack,
} from "@securitydept/client";
import { waitForTokenSetPopupRelay } from "../../orchestration/client/popup/relay";
import {
	BaseOidcModeClient,
	TokenSetAuthorizationRevocationError,
	TokenSetAuthorizationRevocationReason,
	type TokenSetOidcPopupLoginOptions,
	type TokenSetOidcPopupLoginResult,
	type TokenSetOidcRedirectLoginOptions,
} from "../../orchestration/index";
import { type TokenSetTokenFreshnessTiming } from "../../orchestration/token/freshness";
import { mergeTokenSetTokenDelta } from "../../orchestration/token/ops";
import {
	type TokenSetAuthMetadataSnapshot,
	type TokenSetAuthSnapshot,
} from "../../orchestration/token/types";
import {
	type BackendOidcModeMetadataRedemptionResponse,
	type BackendOidcModeUserInfoResponse,
} from "../contracts/contracts";
import {
	callbackReturnsToTokenSnapshot,
	parseBackendOidcModeCallbackPayload,
	parseBackendOidcModeOAuthErrorPayload,
	parseBackendOidcModeRefreshPayload,
	parseBackendOidcModeUserInfoBody,
	refreshReturnsToTokenDelta,
} from "../contracts/parsers";
import { BackendOidcModeErrorCode } from "./error-codes";
import {
	BackendOidcModeOperationEventName,
	BackendOidcModeTraceEventType,
	BackendOidcModeTraceOperationName,
} from "./trace-events";
import {
	type BackendOidcModeClientConfig,
	type BackendOidcModeClientDefaultOptions,
	type BackendOidcModeFetchUserInfoOptions,
	type BackendOidcModeMetadataRedemptionOptions,
	type ResolvedBackendOidcModeClientConfig,
} from "./types";

const TRACE_TARGET = "backend-oidc-mode";
const TRACE_PREFIX = "backend_oidc";

type BackendOperationFields =
	| Record<string, unknown>
	| ((this: BackendOidcModeClient) => Record<string, unknown> | undefined);

const instrumentBackendMethod = defineInstrumentMethodDecorator<
	[name: string, fields?: BackendOperationFields],
	BackendOidcModeClient
>(
	({ factoryArgs: [name, fields] }) =>
		function (this: BackendOidcModeClient) {
			return {
				environment: this.environment,
				span: this.span,
				name,
				target: TRACE_TARGET,
				fields: typeof fields === "function" ? fields.call(this) : fields,
				normalizeError: (error: unknown) =>
					ClientError.fromUnknown(error, {
						code: BackendOidcModeErrorCode.OperationFailed,
						message: "The backend OIDC operation failed unexpectedly",
						source: TRACE_TARGET,
					}),
			};
		},
);

/**
 * Backend OIDC Mode Client.
 *
 * Manages token-set authentication including:
 * - Callback fragment parsing from redirect
 * - Metadata redemption
 * - In-memory auth state signal
 * - Deadline-based refresh scheduling
 * - Environment-backed trace and persistence integration
 * - Bearer header construction
 */
export class BackendOidcModeClient extends BaseOidcModeClient {
	static override defaultOptions = {
		...BaseOidcModeClient.defaultOptions,
		loginPath: "/auth/oidc/login",
		refreshPath: "/auth/oidc/refresh",
		metadataRedeemPath: "/auth/oidc/metadata/redeem",
		userInfoPath: "/auth/oidc/user-info",
		persistenceKeyPrefix: "securitydept.backend_oidc",
	} as const satisfies BackendOidcModeClientDefaultOptions;

	static resolveDefaultPersistenceKey(baseUrl: string): string {
		const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
		return `${BackendOidcModeClient.defaultOptions.persistenceKeyPrefix}:v1:${normalizedBaseUrl}`;
	}

	private readonly _config: ResolvedBackendOidcModeClientConfig;

	constructor(
		config: BackendOidcModeClientConfig,
		environment: FoundationEnvironment,
	) {
		const baseUrl = config.baseUrl.replace(/\/+$/, "");
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
							BackendOidcModeClient.resolveDefaultPersistenceKey(baseUrl),
					}
				: undefined,
		});

		this._config = {
			...config,
			baseUrl,
			loginPath:
				config.loginPath ?? BackendOidcModeClient.defaultOptions.loginPath,
			refreshPath:
				config.refreshPath ?? BackendOidcModeClient.defaultOptions.refreshPath,
			metadataRedeemPath:
				config.metadataRedeemPath ??
				BackendOidcModeClient.defaultOptions.metadataRedeemPath,
			userInfoPath:
				config.userInfoPath ??
				BackendOidcModeClient.defaultOptions.userInfoPath,
		};
	}

	/** The resolved configuration. */
	get config(): Readonly<ResolvedBackendOidcModeClientConfig> {
		return this._config;
	}

	/** Build the login/authorize URL with optional post-auth redirect. */
	authorizeUrl(postAuthRedirectUri?: string): string {
		const base = this._config.baseUrl + this._config.loginPath;
		const effectiveRedirectUri =
			postAuthRedirectUri ?? this._config.defaultPostAuthRedirectUri;
		if (effectiveRedirectUri) {
			const params = new URLSearchParams({
				post_auth_redirect_uri: effectiveRedirectUri,
			});
			return `${base}?${params.toString()}`;
		}
		return base;
	}

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

	@instrumentBackendMethod(BackendOidcModeTraceOperationName.LoginRedirect)
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
				code: BackendOidcModeErrorCode.RedirectRouterUnavailable,
				message: "Backend OIDC redirect login requires environment.router.",
				source: TRACE_TARGET,
			});
		}
		await router.navigate({
			url: UriReferenceString.parse(
				this.authorizeUrl(options.postAuthRedirectUri),
			),
			intent: RouterNavigationIntent.AuthRedirect,
			mode: RouterNavigationMode.External,
		});
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.setAttributes({ navigationMode: "external" });
	}

	@withDisposableStack(0, true)
	@instrumentBackendMethod(BackendOidcModeTraceOperationName.LoginPopup)
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
		const popup = this._environment.popup;
		if (!popup) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: BackendOidcModeErrorCode.PopupCapabilityMissing,
				message: "Backend OIDC popup login requires environment.popup.",
				source: TRACE_TARGET,
				recovery: UserRecovery.RestartFlow,
			});
		}

		const popupCallbackUrl = new URL(
			options.popupCallbackUrl,
			this._config.baseUrl,
		);
		const popupWindow = popup.open(
			this.authorizeUrl(options.popupCallbackUrl),
			{
				expectedOrigin: popupCallbackUrl.origin,
				width: options.popupWidth,
				height: options.popupHeight,
			},
		);
		operationSpan?.addEvent(BackendOidcModeOperationEventName.PopupOpened, {
			popupCallbackUrl: options.popupCallbackUrl,
		});

		const callbackUrl = await waitForTokenSetPopupRelay({
			popup: popupWindow,
			time: this._environment.time,
			timeoutMs: options.timeoutMs,
			cancellationToken,
		});
		cancellationToken.throwIfCancellationRequested();
		operationSpan?.addEvent(
			BackendOidcModeOperationEventName.PopupRelaySucceeded,
			{
				popupCallbackUrl: options.popupCallbackUrl,
			},
		);
		const compatFragment = parseCompatFragment(new URL(callbackUrl));
		if (!compatFragment) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: BackendOidcModeErrorCode.PopupFragmentMissing,
				message: "Popup callback URL has no compat fragment to process.",
				source: TRACE_TARGET,
			});
		}

		const snapshot = await this._handleCallbackOperation(
			compatFragment.parameters,
			cancellationToken,
		);
		cancellationToken.throwIfCancellationRequested();
		return { snapshot };
	}

	/**
	 * Handle a parsed callback compat fragment from a redirect flow.
	 *
	 * Parses tokens, redeems metadata if a redemption ID is present, persists
	 * state, and updates the auth signal. Inline metadata (from
	 * `callback_body_return` servers) is used directly, skipping redemption.
	 */
	@withDisposableStack(1, true)
	async handleCallback(
		parsedCompatFragment: CompatFragmentParameters,
		options: CancellationTokenOptions = {},
	): Promise<TokenSetAuthSnapshot> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._handleCallbackOperation(
			parsedCompatFragment,
			cancellationToken,
		);
	}

	@instrumentBackendMethod(BackendOidcModeTraceOperationName.Callback, {
		flow: "callback.fragment",
	})
	private async _handleCallbackOperation(
		parsedCompatFragment: CompatFragmentParameters,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot> {
		cancellationToken.throwIfCancellationRequested();

		const callbackFragment =
			parseBackendOidcModeCallbackPayload(parsedCompatFragment);
		if (!callbackFragment) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				message: "Callback fragment missing access_token or id_token",
				code: BackendOidcModeErrorCode.CallbackAccessTokenMissing,
				source: TRACE_TARGET,
			});
		}

		const tokenSnapshot = callbackReturnsToTokenSnapshot(callbackFragment);
		const metadata = await this._resolveMetadata(
			{
				inlineMetadata: callbackFragment.metadata,
				metadataRedemptionId: callbackFragment.metadataRedemptionId,
				baseMetadata: {},
				accessToken: tokenSnapshot.accessToken,
				idToken: tokenSnapshot.idToken,
			},
			cancellationToken,
			operationSpan,
		);

		cancellationToken.throwIfCancellationRequested();

		const snapshot: TokenSetAuthSnapshot = {
			tokens: tokenSnapshot,
			metadata,
		};

		await this._applySnapshot(snapshot, {}, cancellationToken, operationSpan);
		operationSpan?.setAttributes({
			hasMetadataRedemption:
				callbackFragment.metadataRedemptionId !== undefined,
			hasInlineMetadata: callbackFragment.metadata !== undefined,
			hasUserInfoFallback:
				!callbackFragment.metadata && !callbackFragment.metadataRedemptionId,
			persisted: this._persistence !== null,
		});

		return snapshot;
	}

	/**
	 * Handle a callback from a JSON body response (body-return flow).
	 *
	 * Unlike {@link handleCallback}, this method accepts the parsed JSON object
	 * from a `callback_body_return` (200 OK) response:
	 *
	 * - Metadata is embedded inline — no redemption round-trip
	 * - No URL fragment parsing
	 *
	 * Use this when the server uses `callback_body_return` and the client
	 * receives the JSON body directly (e.g. in a single-page app that POSTs
	 * the code to the backend and reads the 200 OK response).
	 */
	@withDisposableStack(1, true)
	async handleCallbackBody(
		body: HttpResponseJsonBody,
		options: CancellationTokenOptions = {},
	): Promise<TokenSetAuthSnapshot> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._handleCallbackBodyOperation(body, cancellationToken);
	}

	@instrumentBackendMethod(BackendOidcModeTraceOperationName.Callback, {
		flow: "callback.body",
	})
	private async _handleCallbackBodyOperation(
		body: HttpResponseJsonBody,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot> {
		cancellationToken.throwIfCancellationRequested();

		const callbackBody = parseBackendOidcModeCallbackPayload(body);
		if (!callbackBody) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				message: "Callback response body missing access_token or id_token",
				code: BackendOidcModeErrorCode.CallbackAccessTokenMissing,
				source: TRACE_TARGET,
			});
		}

		const cbTokenSnapshot = callbackReturnsToTokenSnapshot(callbackBody);
		const metadata = await this._resolveMetadata(
			{
				inlineMetadata: callbackBody.metadata,
				metadataRedemptionId: callbackBody.metadataRedemptionId,
				baseMetadata: {},
				accessToken: cbTokenSnapshot.accessToken,
				idToken: cbTokenSnapshot.idToken,
			},
			cancellationToken,
			operationSpan,
		);

		cancellationToken.throwIfCancellationRequested();

		const snapshot: TokenSetAuthSnapshot = {
			tokens: cbTokenSnapshot,
			metadata,
		};

		await this._applySnapshot(snapshot, {}, cancellationToken, operationSpan);
		operationSpan?.setAttributes({
			hasMetadataRedemption: callbackBody.metadataRedemptionId !== undefined,
			hasInlineMetadata: callbackBody.metadata !== undefined,
			hasUserInfoFallback:
				!callbackBody.metadata && !callbackBody.metadataRedemptionId,
			persisted: this._persistence !== null,
		});

		return snapshot;
	}

	/**
	 * Attempt to refresh the current token set.
	 *
	 * Protocol: The server's `refresh_body_return` endpoint responds with
	 * 200 OK and a JSON body containing the token delta. This avoids the
	 * 302 → fragment pattern that fetch() cannot follow across domains.
	 */
	protected async _refreshAuthSnapshot(
		current: TokenSetAuthSnapshot,
		_freshnessTiming: TokenSetTokenFreshnessTiming,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<TokenSetAuthSnapshot | null> {
		if (!current.tokens.refreshMaterial) {
			return null;
		}

		cancellationToken.throwIfCancellationRequested();

		const response = await this._environment.transport.execute({
			url: this._config.baseUrl + this._config.refreshPath,
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				refresh_token: current.tokens.refreshMaterial,
				post_auth_redirect_uri: this._config.defaultPostAuthRedirectUri,
				id_token: current.tokens.idToken,
				current_metadata_snapshot: current.metadata,
			}),
			cancellationToken,
		});

		cancellationToken.throwIfCancellationRequested();

		if (response.status === 200 && response.body) {
			const refreshBody = parseBackendOidcModeRefreshPayload(
				response.body as HttpResponseJsonBody,
			);
			if (!refreshBody) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message: "Refresh response body missing access_token",
					code: BackendOidcModeErrorCode.RefreshAccessTokenMissing,
					source: TRACE_TARGET,
				});
			}

			const metadata = await this._resolveMetadata(
				{
					inlineMetadata: refreshBody.metadata
						? { ...current.metadata, ...refreshBody.metadata }
						: undefined,
					metadataRedemptionId: refreshBody.metadataRedemptionId,
					baseMetadata: current.metadata,
					accessToken: refreshBody.accessToken,
					idToken: refreshBody.idToken ?? current.tokens.idToken,
				},
				cancellationToken,
				operationSpan,
			);

			cancellationToken.throwIfCancellationRequested();

			const newSnapshot: TokenSetAuthSnapshot = {
				tokens: mergeTokenSetTokenDelta(
					current.tokens,
					refreshReturnsToTokenDelta(refreshBody),
				),
				metadata,
			};

			operationSpan?.setAttributes({
				hasMetadataRedemption: refreshBody.metadataRedemptionId !== undefined,
				hasInlineMetadata: refreshBody.metadata !== undefined,
				hasUserInfoFallback:
					!refreshBody.metadata && !refreshBody.metadataRedemptionId,
				persisted: this._persistence !== null,
			});

			return newSnapshot;
		}

		const oauthError = response.body
			? parseBackendOidcModeOAuthErrorPayload(
					response.body as HttpResponseJsonBody,
				)
			: null;
		if (
			oauthError?.error === TokenSetAuthorizationRevocationReason.InvalidGrant
		) {
			throw new TokenSetAuthorizationRevocationError({
				reason: TokenSetAuthorizationRevocationReason.InvalidGrant,
				cause: response.body,
			});
		}
		const challenge =
			response.headers["WWW-Authenticate"] ??
			response.headers["www-authenticate"];
		if (
			response.status === 401 &&
			challenge !== undefined &&
			/^Bearer\s+/i.test(challenge) &&
			/(?:^|,)\s*error\s*=\s*"?invalid_token"?(?:\s*,|\s*$)/i.test(challenge)
		) {
			throw new TokenSetAuthorizationRevocationError({
				reason: TokenSetAuthorizationRevocationReason.InvalidToken,
				cause: response,
			});
		}
		throw ClientError.fromHttpResponse({
			status: response.status,
			body: response.body,
		});
	}

	/**
	 * Resolve auth-state metadata for a callback or refresh result.
	 *
	 * Resolution order (first match wins):
	 *
	 * 1. **Inline** — server embedded metadata directly in the response body.
	 * 2. **Redemption** — server returned a one-time redemption ID; fetch from
	 *    the metadata-redeem endpoint.
	 * 3. **UserInfo fallback** — neither inline metadata nor a redemption ID is
	 *    present; call `/user-info` and populate `metadata.principal` from the
	 *    response. This costs one extra request but guarantees that `principal`
	 *    is always populated after authentication.
	 */
	private async _resolveMetadata(
		opts: {
			/** Already-resolved inline metadata (skip all network calls). */
			inlineMetadata?: TokenSetAuthMetadataSnapshot;
			/** One-time redemption ID from the response body. */
			metadataRedemptionId?: string;
			/** Starting metadata to merge into (e.g. current snapshot for refresh). */
			baseMetadata: TokenSetAuthMetadataSnapshot;
			/** Access token to use for the userInfo fallback. */
			accessToken: string;
			/** ID token to include in the userInfo request body. */
			idToken?: string;
		},
		cancellationToken: CancellationTokenTrait,
		span?: OperationSpanTrait,
	): Promise<TokenSetAuthMetadataSnapshot> {
		const {
			inlineMetadata,
			metadataRedemptionId,
			baseMetadata,
			accessToken,
			idToken,
		} = opts;
		cancellationToken.throwIfCancellationRequested();

		// Priority 1: inline metadata already present.
		if (inlineMetadata) {
			return inlineMetadata;
		}

		// Priority 2: one-time redemption ID.
		if (metadataRedemptionId) {
			const redeemed = await this._redeemMetadata(
				metadataRedemptionId,
				cancellationToken,
				span,
			);
			if (redeemed) {
				cancellationToken.throwIfCancellationRequested();
				return redeemed.metadata as TokenSetAuthMetadataSnapshot;
			}
		}

		// Priority 3: userInfo fallback — populate principal from /user-info.
		// We never call this if we already have a principal in baseMetadata,
		// to avoid a redundant request on servers that deliver metadata via
		// inline/redemption only on the first login.
		if (!baseMetadata.principal) {
			try {
				const userInfo = await this._fetchUserInfoRaw(
					accessToken,
					idToken,
					cancellationToken,
				);
				return {
					...baseMetadata,
					principal: {
						subject: userInfo.subject,
						displayName: userInfo.displayName,
						picture: userInfo.picture,
						issuer: userInfo.issuer,
						claims: userInfo.claims,
					},
				};
			} catch (error) {
				cancellationToken.throwIfCancellationRequested();
				this._recordFailureTrace(
					BackendOidcModeTraceEventType.UserInfoFallbackFailed,
					error,
					undefined,
					span ?? this.span,
				);
			}
		}

		return baseMetadata;
	}

	private async _redeemMetadata(
		redemptionId: string,
		cancellationToken: CancellationTokenTrait,
		span?: OperationSpanTrait,
	): Promise<BackendOidcModeMetadataRedemptionResponse | null> {
		span?.addEvent(
			BackendOidcModeOperationEventName.MetadataRedemptionStarted,
			{
				redemptionId,
			},
		);

		cancellationToken.throwIfCancellationRequested();

		const response = await this._environment.transport.execute({
			url: this._config.baseUrl + this._config.metadataRedeemPath,
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				metadata_redemption_id: redemptionId,
			}),
			cancellationToken,
		});

		cancellationToken.throwIfCancellationRequested();

		if (response.status === 200 && response.body) {
			span?.addEvent(
				BackendOidcModeOperationEventName.MetadataRedemptionSucceeded,
				{
					redemptionId,
					found: true,
				},
			);
			return response.body as BackendOidcModeMetadataRedemptionResponse;
		}

		if (response.status === 404) {
			span?.addEvent(
				BackendOidcModeOperationEventName.MetadataRedemptionSucceeded,
				{
					redemptionId,
					found: false,
				},
			);
			return null;
		}

		throw ClientError.fromHttpResponse({
			status: response.status,
			body: response.body,
		});
	}

	/** Redeem metadata from the server by redemption ID. */
	@withDisposableStack(1, true)
	async redeemMetadata(
		redemptionId: string,
		options: BackendOidcModeMetadataRedemptionOptions = {},
	): Promise<BackendOidcModeMetadataRedemptionResponse | null> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._redeemMetadataOperation(redemptionId, cancellationToken);
	}

	@instrumentBackendMethod(BackendOidcModeTraceOperationName.MetadataRedemption)
	private async _redeemMetadataOperation(
		redemptionId: string,
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BackendOidcModeMetadataRedemptionResponse | null> {
		return await this._redeemMetadata(
			redemptionId,
			cancellationToken,
			operationSpan,
		);
	}

	/**
	 * Exchange the current id_token + access_token for normalized user info.
	 *
	 * Protocol: POST /auth/oidc/user-info (SDK default) with Bearer access_token
	 * and JSON body `{ id_token }`. Returns the server-normalized user info.
	 */
	@withDisposableStack(0, true)
	async fetchUserInfo(
		options: BackendOidcModeFetchUserInfoOptions = {},
	): Promise<BackendOidcModeUserInfoResponse> {
		const disposableStack = injectDisposableStackFrom(options, true);
		const cancellationToken = createLinkedCancellationToken(
			this._rootCancellation.token,
			options.cancellationToken,
		);
		disposableStack?.use(cancellationToken);
		return await this._fetchUserInfoFromCurrentState(cancellationToken);
	}

	@instrumentBackendMethod(BackendOidcModeTraceOperationName.UserInfo)
	private async _fetchUserInfoFromCurrentState(
		cancellationToken: CancellationTokenTrait,
		operationSpan?: OperationSpanTrait,
	): Promise<BackendOidcModeUserInfoResponse> {
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
				code: BackendOidcModeErrorCode.UserInfoUnauthenticated,
				source: TRACE_TARGET,
			});
		}

		return await this._fetchUserInfoRaw(
			current.tokens.accessToken,
			current.tokens.idToken,
			cancellationToken,
		);
	}

	/**
	 * Raw userInfo HTTP call — accepts explicit tokens rather than reading
	 * from current state. Used by `fetchUserInfo` and by `_resolveMetadata`
	 * as a best-effort fallback when no metadata is delivered with the token
	 * response.
	 */
	private async _fetchUserInfoRaw(
		accessToken: string,
		idToken: string | undefined,
		cancellationToken: CancellationTokenTrait,
	): Promise<BackendOidcModeUserInfoResponse> {
		cancellationToken.throwIfCancellationRequested();
		const response = await this._environment.transport.execute({
			url: this._config.baseUrl + this._config.userInfoPath,
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${accessToken}`,
			},
			body: JSON.stringify({
				id_token: idToken,
			}),
			cancellationToken,
		});
		cancellationToken.throwIfCancellationRequested();

		if (response.status === 200 && response.body) {
			const parsed = parseBackendOidcModeUserInfoBody(
				response.body as Record<string, unknown>,
			);
			if (!parsed) {
				throw new ClientError({
					kind: ClientErrorKind.Protocol,
					message: "User info response missing required 'subject' field",
					code: BackendOidcModeErrorCode.UserInfoInvalidResponse,
					source: TRACE_TARGET,
				});
			}
			return parsed;
		}

		throw ClientError.fromHttpResponse({
			status: response.status,
			body: response.body,
		});
	}
}
