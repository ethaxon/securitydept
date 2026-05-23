import {
	createAndThenComputedReplaySignal,
	createEventStream,
	createReplaySignal,
	createSignal,
	createTraceTimelineStore,
	readonlyReplaySignal,
	readonlySignal,
} from "@securitydept/client";
import type { NativeWebEnvironment } from "@securitydept/client/web";
import { createCrossTabSync, PopupErrorCode } from "@securitydept/client/web";
import type { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	createFrontendOidcModeBrowserClient,
	createFrontendOidcModeWebClientEnvironment,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import type { TokenSetReactClient } from "@securitydept/token-set-context-client-react";
import {
	TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	TOKEN_SET_FRONTEND_MODE_CONFIG_PATH,
	TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
	TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH,
} from "@/lib/tokenSetConfig";

const TOKEN_SET_FRONTEND_PERSISTENT_PREFIX =
	"securitydept.webui.token-set-frontend:persistent:";
const TOKEN_SET_FRONTEND_SESSION_PREFIX =
	"securitydept.webui.token-set-frontend:session:";
export const TOKEN_SET_FRONTEND_HOST_TRACE_SCOPE =
	"apps.webui.token-set-frontend";
export const TOKEN_SET_FRONTEND_HOST_TRACE_SOURCE = "webui.token-set-frontend";

export const FrontendHostTraceEventType = {
	CrossTabHydrated: "frontend_oidc.host.cross_tab.hydrated",
	CrossTabCleared: "frontend_oidc.host.cross_tab.cleared",
} as const;

let tokenSetFrontendModeClientPromise: Promise<FrontendOidcModeClient> | null =
	null;
const tokenSetFrontendModeAuthSnapshotSignal =
	createReplaySignal<AuthSnapshot | null>();
const tokenSetFrontendModeLastAuthErrorSignal = createSignal<
	unknown | undefined
>(undefined);
const tokenSetFrontendModeAuthOperationSignals = {
	restorePending: createSignal(false),
	refreshPending: createSignal(false),
	clearPending: createSignal(false),
	loginPending: createSignal(false),
};
let tokenSetFrontendModeStateUnsubscribe: (() => void) | null = null;
let tokenSetFrontendModePersistentStorageKey: string | null = null;
let tokenSetFrontendModeCrossTabSync: ReturnType<
	typeof createCrossTabSync
> | null = null;
const tokenSetFrontendModeAuthCheckTriggerSubscriptions = new Map<
	Parameters<FrontendOidcModeClient["addWorkflowSource"]>[0],
	{ unsubscribe(): void }
>();
let lastObservedFrontendModeAccessToken = false;

export const tokenSetFrontendModeTraceTimeline = createTraceTimelineStore();

type FrontendModeCrossTabStatus = {
	syncCount: number;
	lastEvent: "idle" | "hydrated" | "cleared";
	hasAccessToken: boolean;
	updatedAt: number | null;
};

const tokenSetFrontendModeCrossTabStatusSignal =
	createSignal<FrontendModeCrossTabStatus>({
		syncCount: 0,
		lastEvent: "idle",
		hasAccessToken: false,
		updatedAt: null,
	});

export const tokenSetFrontendModeCrossTabStatus = readonlySignal(
	tokenSetFrontendModeCrossTabStatusSignal,
);

type TokenSetFrontendModeReactClient = TokenSetReactClient &
	Pick<FrontendOidcModeClient, "refresh" | "clearState">;

function recordFrontendHostTrace(
	type: string,
	attributes?: Record<string, unknown>,
): void {
	tokenSetFrontendModeTraceTimeline.record({
		type,
		at: Date.now(),
		scope: TOKEN_SET_FRONTEND_HOST_TRACE_SCOPE,
		source: TOKEN_SET_FRONTEND_HOST_TRACE_SOURCE,
		attributes,
	});
}

function updateFrontendModeCrossTabStatus(
	lastEvent: FrontendModeCrossTabStatus["lastEvent"],
	hasAccessToken: boolean,
): void {
	const nextCount =
		tokenSetFrontendModeCrossTabStatusSignal.get().syncCount + 1;
	tokenSetFrontendModeCrossTabStatusSignal.set({
		syncCount: nextCount,
		lastEvent,
		hasAccessToken,
		updatedAt: Date.now(),
	});
	recordFrontendHostTrace(
		lastEvent === "hydrated"
			? FrontendHostTraceEventType.CrossTabHydrated
			: FrontendHostTraceEventType.CrossTabCleared,
		{
			hasAccessToken,
			syncCount: nextCount,
		},
	);
}

function reconcileFrontendModeCrossTabStatus(
	snapshot: AuthSnapshot | null,
): void {
	const hasAccessToken = Boolean(snapshot?.tokens.accessToken);
	if (hasAccessToken && !lastObservedFrontendModeAccessToken) {
		updateFrontendModeCrossTabStatus("hydrated", true);
	} else if (!hasAccessToken && lastObservedFrontendModeAccessToken) {
		updateFrontendModeCrossTabStatus("cleared", false);
	}
	lastObservedFrontendModeAccessToken = hasAccessToken;
}

function buildAbsoluteUrl(path: string): string {
	return new URL(path, window.location.origin).toString();
}

function readFrontendModeSnapshot(): AuthSnapshot | null {
	const slot = tokenSetFrontendModeAuthSnapshotSignal.get();
	return slot.kind === "value" ? slot.value : null;
}

function mirrorFrontendModeClientSignals(
	client: FrontendOidcModeClient,
): () => void {
	const syncSnapshot = () => {
		const slot = client.authSnapshot.get();
		if (slot.kind === "value") {
			tokenSetFrontendModeAuthSnapshotSignal.emit(slot.value);
			reconcileFrontendModeCrossTabStatus(slot.value);
		} else {
			tokenSetFrontendModeAuthSnapshotSignal.clear();
		}
	};
	const syncLastError = () => {
		tokenSetFrontendModeLastAuthErrorSignal.set(client.lastAuthError.get());
	};
	const syncOperation =
		(key: keyof typeof tokenSetFrontendModeAuthOperationSignals) => () => {
			tokenSetFrontendModeAuthOperationSignals[key].set(
				client.authOperations[key].get(),
			);
		};

	syncSnapshot();
	syncLastError();
	for (const key of Object.keys(
		tokenSetFrontendModeAuthOperationSignals,
	) as Array<keyof typeof tokenSetFrontendModeAuthOperationSignals>) {
		syncOperation(key)();
	}

	const unsubscribes = [
		client.authSnapshot.subscribe(syncSnapshot),
		client.lastAuthError.subscribe(syncLastError),
		...(
			Object.keys(tokenSetFrontendModeAuthOperationSignals) as Array<
				keyof typeof tokenSetFrontendModeAuthOperationSignals
			>
		).map((key) => client.authOperations[key].subscribe(syncOperation(key))),
	];
	return () => {
		for (const unsubscribe of unsubscribes) {
			unsubscribe();
		}
	};
}

function ensureTokenSetFrontendModeCrossTabSync(
	client: FrontendOidcModeClient,
): void {
	if (
		tokenSetFrontendModeCrossTabSync ||
		tokenSetFrontendModePersistentStorageKey === null
	) {
		return;
	}

	tokenSetFrontendModeCrossTabSync = createCrossTabSync({
		key: tokenSetFrontendModePersistentStorageKey,
		storageEventTarget: window,
		onSync: ({ newValue }) => {
			void (async () => {
				if (newValue === null) {
					await client.clearState({ persistPolicy: "skip" });
					lastObservedFrontendModeAccessToken = false;
					updateFrontendModeCrossTabStatus("cleared", false);
					return;
				}

				const snapshot = await client.restorePersistedState();
				reconcileFrontendModeCrossTabStatus(snapshot);
			})();
		},
	});
}

async function createTokenSetFrontendModeClient(): Promise<FrontendOidcModeClient> {
	const redirectUri = buildAbsoluteUrl(TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH);
	const environment = createFrontendOidcModeWebClientEnvironment({
		persistentStoragePrefix: TOKEN_SET_FRONTEND_PERSISTENT_PREFIX,
		sessionStoragePrefix: TOKEN_SET_FRONTEND_SESSION_PREFIX,
		traceSink: tokenSetFrontendModeTraceTimeline,
	});
	const materialized = await createFrontendOidcModeBrowserClient({
		configEndpoint: TOKEN_SET_FRONTEND_MODE_CONFIG_PATH,
		redirectUri,
		defaultPostAuthRedirectUri: "/",
		environment,
	});
	tokenSetFrontendModePersistentStorageKey =
		materialized.browserPersistentStorageKey;

	return materialized.client;
}

async function ensureTokenSetFrontendModeClientSubscribed(): Promise<FrontendOidcModeClient> {
	const client = await getTokenSetFrontendModeClient();
	ensureTokenSetFrontendModeCrossTabSync(client);

	if (!tokenSetFrontendModeStateUnsubscribe) {
		tokenSetFrontendModeStateUnsubscribe =
			mirrorFrontendModeClientSignals(client);
	}

	return client;
}

const tokenSetFrontendModeReactClient: TokenSetFrontendModeReactClient = {
	authDetermined: createAndThenComputedReplaySignal(
		tokenSetFrontendModeAuthSnapshotSignal,
		() => ({ kind: "value", value: true }),
	),
	authSnapshot: readonlyReplaySignal(tokenSetFrontendModeAuthSnapshotSignal),
	isAuthenticated: createAndThenComputedReplaySignal(
		tokenSetFrontendModeAuthSnapshotSignal,
		(snapshot) => ({
			kind: "value",
			value: Boolean(snapshot?.tokens.accessToken),
		}),
	),
	authorizationHeaderValue: createAndThenComputedReplaySignal(
		tokenSetFrontendModeAuthSnapshotSignal,
		(snapshot) => ({
			kind: "value",
			value: snapshot?.tokens.accessToken
				? `Bearer ${snapshot.tokens.accessToken}`
				: undefined,
		}),
	),
	lastAuthError: readonlySignal(tokenSetFrontendModeLastAuthErrorSignal),
	authOperations: {
		restorePending: readonlySignal(
			tokenSetFrontendModeAuthOperationSignals.restorePending,
		),
		refreshPending: readonlySignal(
			tokenSetFrontendModeAuthOperationSignals.refreshPending,
		),
		clearPending: readonlySignal(
			tokenSetFrontendModeAuthOperationSignals.clearPending,
		),
		loginPending: readonlySignal(
			tokenSetFrontendModeAuthOperationSignals.loginPending,
		),
	},
	authEvents: createEventStream((observer) => {
		let unsubscribed = false;
		let subscription: { unsubscribe(): void } | null = null;

		void ensureTokenSetFrontendModeClientSubscribed()
			.then((client) => {
				if (unsubscribed) {
					return;
				}
				subscription = client.authEvents.subscribe(observer);
			})
			.catch((error) => {
				if (!unsubscribed) {
					observer.error?.(error);
				}
			});

		return () => {
			unsubscribed = true;
			subscription?.unsubscribe();
		};
	}),
	addWorkflowSource(source) {
		let unsubscribed = false;
		let subscription: { unsubscribe(): void } | null = null;
		const outerSubscription = {
			unsubscribe() {
				unsubscribed = true;
				subscription?.unsubscribe();
				if (
					tokenSetFrontendModeAuthCheckTriggerSubscriptions.get(source) ===
					outerSubscription
				) {
					tokenSetFrontendModeAuthCheckTriggerSubscriptions.delete(source);
				}
			},
		};
		tokenSetFrontendModeReactClient.removeWorkflowSource(source);
		tokenSetFrontendModeAuthCheckTriggerSubscriptions.set(
			source,
			outerSubscription,
		);
		void ensureTokenSetFrontendModeClientSubscribed()
			.then((client) => {
				if (unsubscribed) {
					return;
				}
				subscription = client.addWorkflowSource(source);
			})
			.catch((error) => {
				tokenSetFrontendModeLastAuthErrorSignal.set(error);
			});

		return outerSubscription;
	},
	removeWorkflowSource(source) {
		const subscription =
			tokenSetFrontendModeAuthCheckTriggerSubscriptions.get(source);
		if (subscription) {
			subscription.unsubscribe();
			return true;
		}
		const clientPromise = tokenSetFrontendModeClientPromise;
		if (!clientPromise) {
			return false;
		}
		void clientPromise
			.then((client) => {
				client.removeWorkflowSource(source);
			})
			.catch((error) => {
				tokenSetFrontendModeLastAuthErrorSignal.set(error);
			});
		return true;
	},
	async start() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.start();
	},
	async authCheck(options) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const result = await client.authCheck(options);
		reconcileFrontendModeCrossTabStatus(result.snapshot);
		return result;
	},
	dispose() {
		tokenSetFrontendModeStateUnsubscribe?.();
		tokenSetFrontendModeStateUnsubscribe = null;
		tokenSetFrontendModeCrossTabSync?.dispose();
		tokenSetFrontendModeCrossTabSync = null;
		for (const subscription of [
			...tokenSetFrontendModeAuthCheckTriggerSubscriptions.values(),
		]) {
			subscription.unsubscribe();
		}
		tokenSetFrontendModeAuthCheckTriggerSubscriptions.clear();
		tokenSetFrontendModeAuthSnapshotSignal.clear();
		tokenSetFrontendModeCrossTabStatusSignal.set({
			syncCount: 0,
			lastEvent: "idle",
			hasAccessToken: false,
			updatedAt: null,
		});
		lastObservedFrontendModeAccessToken = false;
		const clientPromise = tokenSetFrontendModeClientPromise;
		tokenSetFrontendModeClientPromise = null;
		tokenSetFrontendModePersistentStorageKey = null;
		void clientPromise?.then((client) => {
			client.dispose();
		});
	},
	async restorePersistedState() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const snapshot = await client.restorePersistedState();
		reconcileFrontendModeCrossTabStatus(snapshot);
		return snapshot;
	},
	async handleCallback(callbackUrl) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const result = await client.handleCallback(callbackUrl);
		return result;
	},
	async loginWithRedirect(options) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.loginWithRedirect(options);
	},
	async refresh() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const snapshot = await client.refresh();
		reconcileFrontendModeCrossTabStatus(snapshot);
		return snapshot;
	},
	async clearState() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.clearState();
	},
};

export async function getTokenSetFrontendModeClient(): Promise<FrontendOidcModeClient> {
	if (!tokenSetFrontendModeClientPromise) {
		tokenSetFrontendModeClientPromise = createTokenSetFrontendModeClient();
	}

	return await tokenSetFrontendModeClientPromise;
}

export async function ensureTokenSetFrontendModeClientReady(): Promise<AuthSnapshot | null> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.start();
	const snapshot = await client.authSnapshot.whenValue();
	reconcileFrontendModeCrossTabStatus(snapshot);
	return snapshot;
}

export async function startTokenSetFrontendModeLogin(
	environment: NativeWebEnvironment,
	postAuthRedirectUri = "/",
): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.loginWithRedirect({
		postAuthRedirectUri,
		environment,
	});
}

export async function startTokenSetFrontendModePopupLogin(
	postAuthRedirectUri = TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.popupLogin({
		popupCallbackUrl: buildAbsoluteUrl(
			TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH,
		),
		postAuthRedirectUri,
	});
	const snapshot = readFrontendModeSnapshot();
	if (snapshot?.tokens.accessToken) {
		reconcileFrontendModeCrossTabStatus(snapshot);
	}
}

export async function clearTokenSetFrontendModeBrowserState(): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.clearState();
}

export function isTokenSetFrontendPopupError(error: unknown): error is Error & {
	code?: string;
	recovery?: string;
} {
	return typeof error === "object" && error !== null && "code" in error;
}

export { PopupErrorCode };

export function tokenSetFrontendModeClientFactory(): TokenSetReactClient {
	return tokenSetFrontendModeReactClient;
}
