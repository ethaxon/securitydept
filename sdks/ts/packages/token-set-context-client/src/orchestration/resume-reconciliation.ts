import type { ReadableSignalTrait } from "@securitydept/client";
import type {
	CreatePageResumeReconcilerOptions,
	PageResumeEvent,
	PageResumeReconciler,
} from "@securitydept/client/web";
import { createPageResumeReconciler } from "@securitydept/client/web";
import { TokenSetAuthFlowSource } from "./auth-events";
import type { EnsureAuthForResourceOptions } from "./base-client";
import { getTokenFreshness, TokenFreshnessState } from "./token-ops";
import type { AuthSnapshot } from "./types";

const DEFAULT_CLOCK_SKEW_MS = 30_000;
const DEFAULT_REFRESH_WINDOW_MS = 60_000;
const TOKEN_SET_RESUME_RECONCILIATION_ATTACHED = Symbol(
	"token-set-resume-reconciliation-attached",
);

export interface TokenSetResumeReconciliationClient {
	readonly state: ReadableSignalTrait<AuthSnapshot | null>;
	ensureAuthForResource(
		options?: EnsureAuthForResourceOptions,
	): Promise<{ snapshot: AuthSnapshot | null }>;
	dispose(): void;
}

export interface TokenSetResumeReconciliationOptions
	extends Omit<CreatePageResumeReconcilerOptions, "onReconcile"> {
	clockSkewMs?: number;
	refreshWindowMs?: number;
	onReconcileSkipped?: (event: PageResumeEvent) => void;
}

export interface AttachTokenSetResumeReconciliationOptions {
	resumeReconciliation?: boolean;
	resumeReconciliationOptions?: TokenSetResumeReconciliationOptions;
}

export function createTokenSetResumeReconciler(
	client: TokenSetResumeReconciliationClient,
	options: TokenSetResumeReconciliationOptions = {},
): PageResumeReconciler {
	const {
		clockSkewMs,
		refreshWindowMs,
		onReconcileSkipped,
		...pageResumeOptions
	} = options;

	return createPageResumeReconciler({
		...pageResumeOptions,
		onReconcile: async (event) => {
			const snapshot = client.state.get();
			const shouldReconcile = shouldReconcileTokenSetSnapshot(snapshot, {
				clockSkewMs,
				refreshWindowMs,
			});

			await client.ensureAuthForResource({
				source: TokenSetAuthFlowSource.Resume,
				forceRefreshWhenDue: true,
				clockSkewMs,
				refreshWindowMs,
				clearStateWhenUnauthenticated: false,
			});
			if (!shouldReconcile) {
				onReconcileSkipped?.(event);
			}
		},
	});
}

export function attachTokenSetResumeReconciliation<
	TClient extends TokenSetResumeReconciliationClient,
>(
	client: TClient,
	options: AttachTokenSetResumeReconciliationOptions = {},
): TClient {
	const attachedClient = client as TClient & {
		[TOKEN_SET_RESUME_RECONCILIATION_ATTACHED]?: true;
	};
	if (attachedClient[TOKEN_SET_RESUME_RECONCILIATION_ATTACHED] === true) {
		return client;
	}
	if (options.resumeReconciliation === false) {
		return client;
	}

	const reconciler = createTokenSetResumeReconciler(
		client,
		options.resumeReconciliationOptions,
	);
	const originalDispose = client.dispose.bind(client);
	let disposed = false;
	Object.defineProperty(
		attachedClient,
		TOKEN_SET_RESUME_RECONCILIATION_ATTACHED,
		{
			value: true,
			configurable: false,
			enumerable: false,
			writable: false,
		},
	);
	client.dispose = () => {
		if (disposed) return;
		disposed = true;
		reconciler.dispose();
		originalDispose();
	};

	return client;
}

export function shouldReconcileTokenSetSnapshot(
	snapshot: AuthSnapshot | null,
	options: Pick<
		TokenSetResumeReconciliationOptions,
		"clockSkewMs" | "refreshWindowMs"
	> = {},
): boolean {
	if (!snapshot?.tokens.accessToken || !snapshot.tokens.refreshMaterial) {
		return false;
	}

	const freshness = getTokenFreshness(snapshot, {
		now: Date.now(),
		clockSkewMs: options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS,
		refreshWindowMs: options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS,
	});

	return (
		freshness === TokenFreshnessState.RefreshDue ||
		freshness === TokenFreshnessState.Expired
	);
}
