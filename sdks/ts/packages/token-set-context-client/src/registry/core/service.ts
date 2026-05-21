import {
	type ComputedSignalTrait,
	createComputed,
	createSignal,
	type EventStreamTrait,
	type ReadableSignalTrait,
	readonlySignal,
} from "@securitydept/client";
import {
	type AuthSnapshot,
	bearerHeader,
	type EnsureAuthForResourceOptions,
	type EnsureAuthForResourceResult,
	type EnsureAuthorizationHeaderOptions,
	type EnsureFreshAuthStateOptions,
	getTokenFreshness,
	TokenFreshnessState,
	type TokenSetAuthEvent,
} from "../../orchestration";
import type {
	OidcModeClient,
	TokenSetAuthServiceState,
	TokenSetClientEntry,
} from "../contracts/types";
import { TokenSetAuthServiceRestoreStatus } from "../contracts/types";

const TOKEN_FRESHNESS_OPTIONS = {
	clockSkewMs: 30_000,
	refreshWindowMs: 0,
} as const;

export class TokenSetAuthService<TClient extends OidcModeClient> {
	static materializeService<TClient extends OidcModeClient>(
		client: TClient,
		entry: TokenSetClientEntry<TClient>,
	): TokenSetAuthService<TClient> {
		return new TokenSetAuthService(client, entry.autoRestore ?? true);
	}

	static dispose<TClient extends OidcModeClient>(
		service: TokenSetAuthService<TClient>,
	): void {
		service.dispose();
	}

	static accessTokenOf<TClient extends OidcModeClient>(
		service: TokenSetAuthService<TClient>,
	): string | null {
		return service.accessToken.get();
	}

	static async ensureAccessTokenOf<TClient extends OidcModeClient>(
		service: TokenSetAuthService<TClient>,
	): Promise<string | null> {
		return await service.ensureAccessToken();
	}

	static async ensureAuthorizationHeaderOf<TClient extends OidcModeClient>(
		service: TokenSetAuthService<TClient>,
	): Promise<string | null> {
		return await service.ensureAuthorizationHeader();
	}

	static async ensureAuthForResourceOf<TClient extends OidcModeClient>(
		service: TokenSetAuthService<TClient>,
		options: EnsureAuthForResourceOptions,
	): Promise<EnsureAuthForResourceResult> {
		return await service.ensureAuthForResource(options);
	}

	static authEventsOf<TClient extends OidcModeClient>(
		service: TokenSetAuthService<TClient>,
	): EventStreamTrait<TokenSetAuthEvent> {
		return service.authEvents;
	}

	readonly client: TClient;
	readonly authEvents: EventStreamTrait<TokenSetAuthEvent>;
	readonly restorePromise: Promise<AuthSnapshot | null> | null;

	private readonly stateSignal = createSignal<TokenSetAuthServiceState>(
		buildTokenSetAuthServiceState(null, {
			restoreStatus: TokenSetAuthServiceRestoreStatus.Skipped,
			restoreError: null,
			disposed: false,
		}),
	);
	readonly state: ReadableSignalTrait<TokenSetAuthServiceState> =
		readonlySignal(this.stateSignal);
	readonly accessToken: ComputedSignalTrait<string | null> = createComputed(
		() => this.state.get().accessToken,
		[this.state],
	);
	readonly authorizationHeader: ComputedSignalTrait<string | null> =
		createComputed(() => this.state.get().authorizationHeader, [this.state]);
	readonly isAuthenticated: ComputedSignalTrait<boolean> = createComputed(
		() => this.state.get().isAuthenticated,
		[this.state],
	);
	private readonly unsubscribeClientState: () => void;

	constructor(client: TClient, autoRestore = true) {
		this.client = client;
		this.authEvents = client.authEvents;
		this.stateSignal.set(
			buildTokenSetAuthServiceState(client.state.get(), {
				restoreStatus: autoRestore
					? TokenSetAuthServiceRestoreStatus.Restoring
					: TokenSetAuthServiceRestoreStatus.Skipped,
				restoreError: null,
				disposed: false,
			}),
		);
		this.unsubscribeClientState = client.state.subscribe(() => {
			this.updateState({ snapshot: client.state.get() });
		});

		if (autoRestore) {
			const restorePromise = client.restorePersistedState().then(
				(snapshot) => {
					if (this.stateSignal.get().disposed) {
						return snapshot;
					}
					this.updateState({
						snapshot,
						restoreStatus: TokenSetAuthServiceRestoreStatus.Restored,
						restoreError: null,
					});
					return snapshot;
				},
				(error) => {
					if (!this.stateSignal.get().disposed) {
						this.updateState({
							restoreStatus: TokenSetAuthServiceRestoreStatus.Failed,
							restoreError: error,
						});
					}
					throw error;
				},
			);
			restorePromise.catch(() => {});
			this.restorePromise = restorePromise;
		} else {
			this.restorePromise = null;
		}
	}

	async ensureFreshAuthState(
		options?: EnsureFreshAuthStateOptions,
	): Promise<AuthSnapshot | null> {
		return await this.client.ensureFreshAuthState(options);
	}

	async ensureAccessToken(
		options?: EnsureFreshAuthStateOptions,
	): Promise<string | null> {
		return (
			(await this.ensureFreshAuthState(options))?.tokens.accessToken ?? null
		);
	}

	async ensureAuthorizationHeader(
		options?: EnsureAuthorizationHeaderOptions,
	): Promise<string | null> {
		return await this.client.ensureAuthorizationHeader(options);
	}

	async ensureAuthForResource(
		options?: EnsureAuthForResourceOptions,
	): Promise<EnsureAuthForResourceResult> {
		return await this.client.ensureAuthForResource(options);
	}

	dispose(): void {
		if (this.stateSignal.get().disposed) {
			return;
		}
		this.updateState({ disposed: true });
		this.unsubscribeClientState();
		try {
			this.client.dispose();
		} catch {
			// Swallow — best effort.
		}
	}

	private updateState(
		patch: Partial<
			Pick<
				TokenSetAuthServiceState,
				"snapshot" | "restoreStatus" | "restoreError" | "disposed"
			>
		>,
	): void {
		const current = this.stateSignal.get();
		this.stateSignal.set(
			buildTokenSetAuthServiceState(
				"snapshot" in patch ? (patch.snapshot ?? null) : current.snapshot,
				{
					restoreStatus: patch.restoreStatus ?? current.restoreStatus,
					restoreError:
						"restoreError" in patch
							? (patch.restoreError ?? null)
							: current.restoreError,
					disposed: patch.disposed ?? current.disposed,
				},
			),
		);
	}
}

function buildTokenSetAuthServiceState(
	snapshot: AuthSnapshot | null,
	status: Pick<
		TokenSetAuthServiceState,
		"restoreStatus" | "restoreError" | "disposed"
	>,
): TokenSetAuthServiceState {
	const freshness = getTokenFreshness(snapshot, {
		now: Date.now(),
		...TOKEN_FRESHNESS_OPTIONS,
	});
	const isFreshOrUsable =
		freshness === TokenFreshnessState.Fresh ||
		freshness === TokenFreshnessState.RefreshDue ||
		freshness === TokenFreshnessState.NoExpiry;
	const accessToken = isFreshOrUsable
		? (snapshot?.tokens.accessToken ?? null)
		: null;
	const authorizationHeader = accessToken
		? bearerHeader({ accessToken })
		: null;

	return {
		snapshot,
		accessToken,
		authorizationHeader,
		isAuthenticated: accessToken !== null,
		freshness,
		restoreStatus: status.restoreStatus,
		restoreError: status.restoreError,
		disposed: status.disposed,
	};
}
