import {
	type CancellationTokenOptions,
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	createLinkedCancellationToken,
	defineInstrumentMethodDecorator,
	ENVIRONMENT_TOKEN,
	type HttpResponseJsonBody,
	injectDisposableStackFrom,
	type OperationSpanTrait,
	parseCompatFragment,
	RouterNavigationIntent,
	RouterNavigationMode,
	SecuritydeptDestroyRef,
	type SecuritydeptInjectorTrait,
	UriReferenceString,
	UserRecovery,
	withDisposableStack,
} from "@securitydept/client";
import { OidcModeCallbackHandler } from "../../orchestration/client/callback-handler";
import { waitForTokenSetPopupRelay } from "../../orchestration/client/popup/relay";
import {
	TokenSetAuthDeterminationKind,
	TokenSetAuthDeterminationOutcomeKind,
} from "../../orchestration/client/workflows/commit";
import {
	BaseOidcModeClient,
	type OidcModeCallbackHandlingResult,
	type OidcModeCallbackStateTrait,
	PersistPolicy,
	TokenSetAuthEventType,
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
	type BackendOidcModeCallbackInput,
	BackendOidcModeCompatFragmentKind,
} from "../contracts/callback";
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
import { BACKEND_OIDC_MODE_CLIENT_OPTIONS } from "../tokens";
import { createDefaultBackendOidcModeCallbackInputResolver } from "./callback-input-resolver";
import { BackendOidcModeErrorCode } from "./error-codes";
import {
	BackendOidcModeOperationEventName,
	BackendOidcModeTraceEventType,
	BackendOidcModeTraceOperationName,
} from "./trace-events";
import {
	type BackendOidcModeClientDefaultOptions,
	type BackendOidcModeClientOptions,
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

	static fromEnvironmentConfig(
		options: BackendOidcModeClientOptions,
	): BackendOidcModeClient {
		return new BackendOidcModeClient(options);
	}

	static fromInjector(
		injector: SecuritydeptInjectorTrait,
	): BackendOidcModeClient {
		const client = BackendOidcModeClient.fromEnvironmentConfig({
			...injector.get(BACKEND_OIDC_MODE_CLIENT_OPTIONS),
			environment: injector.get(ENVIRONMENT_TOKEN),
		});
		injector
			.get(SecuritydeptDestroyRef, null)
			?.onDestroy(() => client.dispose());
		return client;
	}

	private readonly _config: ResolvedBackendOidcModeClientConfig;
	private readonly _callbackHandler: OidcModeCallbackHandler<
		BackendOidcModeCallbackInput,
		TokenSetAuthSnapshot
	>;
	private readonly _callbackRoutingKey?: string;
	readonly callback: OidcModeCallbackStateTrait<TokenSetAuthSnapshot>;

	protected constructor(options: BackendOidcModeClientOptions) {
		const { config, environment } = options;
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
		this._callbackRoutingKey = options.callbackRoutingKey;
		this._callbackHandler = new OidcModeCallbackHandler({
			environment,
			rootCancellationToken: this._rootCancellation.token,
			inputResolver:
				options.callbackInputResolver === undefined
					? createDefaultBackendOidcModeCallbackInputResolver({
							callbackRoutingKey: options.callbackRoutingKey,
							callbackInputPredicate: options.callbackInputPredicate,
						})
					: options.callbackInputResolver,
			handleInput: (callbackInput, cancellationToken) =>
				this._handleCallbackOperation(callbackInput, cancellationToken),
			createInputNotFoundError: () =>
				new ClientError({
					kind: ClientErrorKind.Protocol,
					code: BackendOidcModeErrorCode.CallbackInputNotFound,
					message: "No backend OIDC callback input was provided.",
					source: TRACE_TARGET,
					recovery: UserRecovery.RestartFlow,
				}),
			normalizeError: (error) =>
				ClientError.fromUnknown(error, {
					code: BackendOidcModeErrorCode.CallbackFailed,
					message: "The backend OIDC callback failed.",
					source: TRACE_TARGET,
				}),
		});
		this.callback = this._callbackHandler;
	}

	/** The resolved configuration. */
	get config(): Readonly<ResolvedBackendOidcModeClientConfig> {
		return this._config;
	}

	protected override async _restoreStateFromCallbackInputOperation(
		cancellationToken: CancellationTokenTrait,
	): Promise<OidcModeCallbackHandlingResult<TokenSetAuthSnapshot | null>> {
		return await this._callbackHandler.restore({ cancellationToken });
	}

	protected override _onDispose(): void {
		this._callbackHandler.dispose();
	}

	/** Build the login/authorize URL with optional post-auth redirect. */
	authorizeUrl(postAuthRedirectUri?: string): string {
		const base = this._config.baseUrl + this._config.loginPath;
		const effectiveRedirectUri =
			postAuthRedirectUri ?? this._config.defaultPostAuthRedirectUri;
		const params = new URLSearchParams();
		if (effectiveRedirectUri) {
			params.set("post_auth_redirect_uri", effectiveRedirectUri);
		}
		if (this._callbackRoutingKey !== undefined) {
			params.set("callback_routing_key", this._callbackRoutingKey);
		}
		const query = params.toString();
		return query ? `${base}?${query}` : base;
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
		if (
			!compatFragment ||
			compatFragment.parameters.kind !==
				BackendOidcModeCompatFragmentKind.Callback
		) {
			throw new ClientError({
				kind: ClientErrorKind.Protocol,
				code: BackendOidcModeErrorCode.PopupFragmentMissing,
				message: "Popup callback URL has no compat fragment to process.",
				source: TRACE_TARGET,
			});
		}
		const {
			kind: _kind,
			callback_routing_key: _callbackRoutingKey,
			...callbackInput
		} = compatFragment.parameters;

		const snapshot = await this._callbackHandler.handle({
			input: callbackInput,
			cancellationToken,
		});
		cancellationToken.throwIfCancellationRequested();
		return { snapshot };
	}

	/** Handle a callback payload from a compat fragment or JSON body response. */
	async handleCallback(
		callbackInput: BackendOidcModeCallbackInput,
		options: CancellationTokenOptions = {},
	): Promise<TokenSetAuthSnapshot> {
		return await this._callbackHandler.handle({
			input: callbackInput,
			cancellationToken: options.cancellationToken,
		});
	}

	private async _handleCallbackOperation(
		callbackInput: BackendOidcModeCallbackInput,
		cancellationToken: CancellationTokenTrait,
	): Promise<TokenSetAuthSnapshot> {
		return await this._runDeterminationWorkflow({
			name: BackendOidcModeTraceOperationName.Callback,
			fields: { flow: "callback" },
			normalizeError: (error) =>
				ClientError.fromUnknown(error, {
					code: BackendOidcModeErrorCode.OperationFailed,
					message: "The backend OIDC operation failed unexpectedly",
					source: TRACE_TARGET,
				}),
			workflow: async (operationSpan) => {
				cancellationToken.throwIfCancellationRequested();
				const callbackPayload =
					parseBackendOidcModeCallbackPayload(callbackInput);
				if (!callbackPayload) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						message: "Callback payload missing access_token or id_token",
						code: BackendOidcModeErrorCode.CallbackAccessTokenMissing,
						source: TRACE_TARGET,
					});
				}

				const tokenSnapshot = callbackReturnsToTokenSnapshot(callbackPayload);
				const metadata = await this._resolveMetadata(
					{
						inlineMetadata: callbackPayload.metadata,
						metadataRedemptionId: callbackPayload.metadataRedemptionId,
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
				operationSpan.setAttributes({
					hasMetadataRedemption:
						callbackPayload.metadataRedemptionId !== undefined,
					hasInlineMetadata: callbackPayload.metadata !== undefined,
					hasUserInfoFallback:
						!callbackPayload.metadata && !callbackPayload.metadataRedemptionId,
					persisted: this._persistence !== null,
				});

				return {
					commit: {
						candidate: {
							kind: TokenSetAuthDeterminationKind.Authenticated,
							snapshot,
						},
						persistPolicy: PersistPolicy.FollowClient,
						events: [
							{
								type: TokenSetAuthEventType.AuthAuthenticated,
								payload: {},
							},
						],
					},
					outcome: {
						kind: TokenSetAuthDeterminationOutcomeKind.Return,
						value: snapshot,
					},
				};
			},
		});
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
