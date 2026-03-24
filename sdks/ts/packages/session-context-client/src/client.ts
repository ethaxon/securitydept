import type {
	CancellationTokenTrait,
	ClientRuntime,
	EphemeralFlowStore,
	HttpTransport,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createEphemeralFlowStore,
} from "@securitydept/client";
import {
	type SessionContextClientConfig,
	SessionContextSource,
	type SessionInfo,
} from "./types";

const DEFAULT_LOGIN_PATH = "/auth/session/login";
const DEFAULT_LOGOUT_PATH = "/auth/session/logout";
const DEFAULT_ME_PATH = "/auth/session/me";
const DEFAULT_POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";
const DEFAULT_LOGIN_REDIRECT_STATE_KEY =
	"securitydept.session_context.pending_login_redirect";

interface SessionUserInfoResponse {
	display_name: string;
	picture?: string;
	claims?: Record<string, unknown>;
}

/**
 * Session Context Client.
 *
 * Provides login/logout URL construction, session probing via `/me`, and
 * minimal session-scoped flow state for login redirect intent.
 */
export class SessionContextClient {
	private readonly _baseUrl: string;
	private readonly _loginPath: string;
	private readonly _logoutPath: string;
	private readonly _mePath: string;
	private readonly _postAuthRedirectParam: string;
	private readonly _pendingLoginRedirectStore?: EphemeralFlowStore<string>;
	private readonly _loginRedirectStateKey: string;

	constructor(
		config: SessionContextClientConfig,
		runtime: Pick<ClientRuntime, "sessionStore"> = {},
	) {
		this._baseUrl = config.baseUrl.replace(/\/+$/, "");
		this._loginPath = config.loginPath ?? DEFAULT_LOGIN_PATH;
		this._logoutPath = config.logoutPath ?? DEFAULT_LOGOUT_PATH;
		this._mePath = config.mePath ?? DEFAULT_ME_PATH;
		this._postAuthRedirectParam =
			config.postAuthRedirectParam ?? DEFAULT_POST_AUTH_REDIRECT_PARAM;
		this._loginRedirectStateKey =
			config.loginRedirectStateKey ??
			`${DEFAULT_LOGIN_REDIRECT_STATE_KEY}:${this._baseUrl || "relative"}`;
		this._pendingLoginRedirectStore = runtime.sessionStore
			? createEphemeralFlowStore<string>({
					store: runtime.sessionStore,
					key: this._loginRedirectStateKey,
					codec: {
						encode(value) {
							return value;
						},
						decode(raw) {
							return raw;
						},
					},
				})
			: undefined;
	}

	/** Build the login URL, optionally with a post-auth redirect. */
	loginUrl(postAuthRedirectUri?: string): string {
		const base = this._baseUrl + this._loginPath;
		if (postAuthRedirectUri) {
			const params = new URLSearchParams({
				[this._postAuthRedirectParam]: postAuthRedirectUri,
			});
			return `${base}?${params.toString()}`;
		}
		return base;
	}

	/** Build the logout URL. */
	logoutUrl(): string {
		return this._baseUrl + this._logoutPath;
	}

	/** Save the pending post-auth redirect in `sessionStore` when available. */
	async savePendingLoginRedirect(postAuthRedirectUri: string): Promise<void> {
		if (!this._pendingLoginRedirectStore) {
			return;
		}

		await this._pendingLoginRedirectStore.save(postAuthRedirectUri);
	}

	/** Load the pending post-auth redirect from `sessionStore`. */
	async loadPendingLoginRedirect(): Promise<string | null> {
		if (!this._pendingLoginRedirectStore) {
			return null;
		}

		return await this._pendingLoginRedirectStore.load();
	}

	/** Load and consume the pending post-auth redirect from `sessionStore`. */
	async consumePendingLoginRedirect(): Promise<string | null> {
		if (!this._pendingLoginRedirectStore) {
			return null;
		}
		return await this._pendingLoginRedirectStore.consume();
	}

	/** Clear the pending post-auth redirect from `sessionStore`. */
	async clearPendingLoginRedirect(): Promise<void> {
		if (!this._pendingLoginRedirectStore) {
			return;
		}

		await this._pendingLoginRedirectStore.clear();
	}

	/**
	 * Fetch the current session info from `/me`.
	 *
	 * Returns `null` only for 401/403 (unauthenticated).
	 * Throws `ClientError` for any other non-2xx response to distinguish
	 * server failures from unauthenticated state.
	 */
	async fetchMe(
		transport: HttpTransport,
		cancellationToken?: CancellationTokenTrait,
	): Promise<SessionInfo | null> {
		const response = await transport.execute({
			url: this._baseUrl + this._mePath,
			method: "GET",
			headers: {},
			cancellationToken,
		});

		if (response.status === 401 || response.status === 403) {
			return null;
		}

		if (response.status >= 200 && response.status < 300) {
			return normalizeSessionInfo(response.body);
		}

		// Non-2xx, non-401/403 — this is a server error, not "unauthenticated".
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	/** Check whether a session exists on the server. */
	async isAuthenticated(
		transport: HttpTransport,
		cancellationToken?: CancellationTokenTrait,
	): Promise<boolean> {
		const me = await this.fetchMe(transport, cancellationToken);
		return me !== null;
	}

	/** Execute logout against the configured session logout endpoint. */
	async logout(
		transport: HttpTransport,
		cancellationToken?: CancellationTokenTrait,
	): Promise<void> {
		const response = await transport.execute({
			url: this.logoutUrl(),
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({}),
			cancellationToken,
		});

		if (response.status >= 200 && response.status < 300) {
			return;
		}

		throw ClientError.fromHttpResponse(response.status, response.body);
	}
}

function normalizeSessionInfo(body: unknown): SessionInfo {
	if (isSessionInfo(body)) {
		return body;
	}

	if (isSessionUserInfoResponse(body)) {
		return {
			principal: {
				displayName: body.display_name,
				picture: body.picture,
				claims: body.claims,
			},
		};
	}

	throw new ClientError({
		kind: ClientErrorKind.Protocol,
		code: "session.invalid_me_payload",
		message: "Session /me payload is invalid",
		source: SessionContextSource.SessionContext,
	});
}

function isSessionInfo(value: unknown): value is SessionInfo {
	return (
		typeof value === "object" &&
		value !== null &&
		"principal" in value &&
		typeof value.principal === "object" &&
		value.principal !== null &&
		"displayName" in value.principal &&
		typeof value.principal.displayName === "string"
	);
}

function isSessionUserInfoResponse(
	value: unknown,
): value is SessionUserInfoResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		"display_name" in value &&
		typeof value.display_name === "string"
	);
}
