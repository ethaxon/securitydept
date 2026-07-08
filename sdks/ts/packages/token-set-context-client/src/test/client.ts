import {
	ClientError,
	ClientErrorKind,
	createSignal,
	type FoundationEnvironment,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
	type WritableSignalTrait,
} from "@securitydept/client";
import { createEnvironmentForTest } from "@securitydept/client/test";
import { BaseOidcModeClient } from "../orchestration/client/base-client";
import {
	type OidcModeCallbackHandlingResult,
	type OidcModeCallbackStateTrait,
	type TokenSetOidcPopupLoginOptions,
	type TokenSetOidcPopupLoginResult,
	type TokenSetOidcRedirectLoginOptions,
} from "../orchestration/client/types";
import { type TokenSetTokenFreshnessTiming } from "../orchestration/token/freshness";
import { type TokenSetAuthSnapshot } from "../orchestration/token/types";

export interface TokenSetClientForTestRefreshOptions {
	readonly authSnapshot: TokenSetAuthSnapshot;
	readonly freshnessTiming: TokenSetTokenFreshnessTiming;
}

export interface CreateTokenSetClientForTestOptions<TResult> {
	readonly environment?: FoundationEnvironment;
	readonly id?: string;
	readonly authSnapshot?: ResourceSnapshot<TokenSetAuthSnapshot | null>;
	readonly callbackSnapshot?: ResourceSnapshot<
		OidcModeCallbackHandlingResult<TResult>
	>;
	readonly refresh?: (
		options: TokenSetClientForTestRefreshOptions,
	) => TokenSetAuthSnapshot | null | Promise<TokenSetAuthSnapshot | null>;
	readonly loginWithRedirect?: (
		options?: TokenSetOidcRedirectLoginOptions,
	) => void | Promise<void>;
	readonly loginWithPopup?: (
		options: TokenSetOidcPopupLoginOptions,
	) => TokenSetOidcPopupLoginResult | Promise<TokenSetOidcPopupLoginResult>;
	readonly cancelCallback?: () => void;
	readonly onDispose?: () => void;
}

export class TokenSetClientForTest<
	TResult = TokenSetAuthSnapshot,
> extends BaseOidcModeClient {
	private readonly callbackSnapshotSignal: WritableSignalTrait<
		ResourceSnapshot<OidcModeCallbackHandlingResult<TResult>>
	>;
	private readonly refreshHandler?: CreateTokenSetClientForTestOptions<TResult>["refresh"];
	private readonly loginWithRedirectHandler?: CreateTokenSetClientForTestOptions<TResult>["loginWithRedirect"];
	private readonly loginWithPopupHandler?: CreateTokenSetClientForTestOptions<TResult>["loginWithPopup"];
	private readonly onDispose?: () => void;

	readonly callback: OidcModeCallbackStateTrait<TResult>;

	constructor(options: CreateTokenSetClientForTestOptions<TResult> = {}) {
		super({
			environment: options.environment ?? createEnvironmentForTest(),
			id: options.id,
			tracing: {
				target: "token_set.test",
				prefix: "token_set.test",
			},
		});
		this.refreshHandler = options.refresh;
		this.loginWithRedirectHandler = options.loginWithRedirect;
		this.loginWithPopupHandler = options.loginWithPopup;
		this.onDispose = options.onDispose;
		if (options.authSnapshot) {
			this._authSnapshotSignal.set(options.authSnapshot);
		}

		this.callbackSnapshotSignal = createSignal(
			options.callbackSnapshot ?? { status: ResourceStatus.Idle },
		);
		const resource = resourceFromSnapshots(() =>
			this.callbackSnapshotSignal.get(),
		);
		this.callback = {
			state: this.callbackSnapshotSignal,
			resource,
			cancel: options.cancelCallback ?? (() => undefined),
		};
	}

	setAuthSnapshot(
		snapshot: ResourceSnapshot<TokenSetAuthSnapshot | null>,
	): void {
		this._authSnapshotSignal.set(snapshot);
	}

	setCallbackSnapshot(
		snapshot: ResourceSnapshot<OidcModeCallbackHandlingResult<TResult>>,
	): void {
		this.callbackSnapshotSignal.set(snapshot);
	}

	async loginWithRedirect(
		options?: TokenSetOidcRedirectLoginOptions,
	): Promise<void> {
		await this.loginWithRedirectHandler?.(options);
	}

	async loginWithPopup(
		options: TokenSetOidcPopupLoginOptions,
	): Promise<TokenSetOidcPopupLoginResult> {
		if (!this.loginWithPopupHandler) {
			throw new ClientError({
				kind: ClientErrorKind.Configuration,
				code: "token_set.test.login_with_popup_not_configured",
				message: "The test client has no popup login handler.",
				source: "token_set.test",
			});
		}
		return await this.loginWithPopupHandler(options);
	}

	protected async _refreshAuthSnapshot(
		authSnapshot: TokenSetAuthSnapshot,
		freshnessTiming: TokenSetTokenFreshnessTiming,
	): Promise<TokenSetAuthSnapshot | null> {
		return this.refreshHandler
			? await this.refreshHandler({ authSnapshot, freshnessTiming })
			: authSnapshot;
	}

	protected override _onDispose(): void {
		this.callback.resource.dispose();
		this.onDispose?.();
	}
}

export function createTokenSetClientForTest<TResult = TokenSetAuthSnapshot>(
	options: CreateTokenSetClientForTestOptions<TResult> = {},
): TokenSetClientForTest<TResult> {
	return new TokenSetClientForTest(options);
}
