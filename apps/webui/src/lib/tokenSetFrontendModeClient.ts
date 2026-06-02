import {
	createAndThenComputedReplaySignal,
	createEventStream,
	createReplaySignal,
	createRootSpan,
	createSignal,
	createTraceTimelineStore,
	createTracing,
	type EventSubscriptionTrait,
	type FoundationEnvironment,
	readonlyReplaySignal,
	readonlySignal,
	SYMBOL_DISPOSE,
	TracingLevel,
} from "@securitydept/client";
import { createCrossTabSync } from "@securitydept/client/web";
import {
	createFrontendOidcModeBrowserClient,
	createFrontendOidcModeWebClientEnvironment,
	type FrontendOidcModeClient,
	TokenSetPopupRelayErrorCode,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	type AuthSnapshot,
	type TokenSetAuthWorkflowSource,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	TOKEN_SET_FRONTEND_MODE_CONFIG_PATH,
	TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH,
} from "@/lib/tokenSetConfig";

const TOKEN_SET_FRONTEND_PERSISTENT_PREFIX =
	"securitydept.webui.token-set-frontend:persistent:";
const TOKEN_SET_FRONTEND_SESSION_PREFIX =
	"securitydept.webui.token-set-frontend:session:";
export const TOKEN_SET_FRONTEND_HOST_TRACE_TARGET =
	"apps.webui.token-set-frontend";

export const FrontendHostTraceEventType = {
	CrossTabHydrated: "frontend_oidc.host.cross_tab.hydrated",
	CrossTabCleared: "frontend_oidc.host.cross_tab.cleared",
} as const;

const tokenSetFrontendModeRootSpan = createRootSpan();
const tokenSetFrontendModeHostSpan = tokenSetFrontendModeRootSpan.fork({
	attributes: {
		target: TOKEN_SET_FRONTEND_HOST_TRACE_TARGET,
		role: "host",
	},
});

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
let tokenSetFrontendModeCrossTabSync: EventSubscriptionTrait | null = null;
const tokenSetFrontendModeAuthCheckTriggerSubscriptions = new Map<
	TokenSetAuthWorkflowSource,
	{ unsubscribe(): void }
>();
let lastObservedFrontendModeAccessToken = false;

export const tokenSetFrontendModeTraceTimeline = createTraceTimelineStore();
export const tokenSetFrontendModeTracing = createTracing({
	subscribers: [tokenSetFrontendModeTraceTimeline],
});

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

type TokenSetFrontendModeViewClient = {
	refresh(): Promise<AuthSnapshot | null>;
	clearState(): Promise<void>;
	logout(): Promise<void>;
} & Pick<
	FrontendOidcModeClient,
	| "authDetermined"
	| "authSnapshot"
	| "isAuthenticated"
	| "authorizationHeaderValue"
	| "lastAuthError"
	| "authOperations"
	| "authEvents"
	| "start"
	| "addWorkflowSource"
	| "removeWorkflowSource"
	| "dispose"
	| "restorePersistedState"
	| "loginWithRedirect"
	| "loginWithPopup"
>;

function recordFrontendHostTrace(
	name: string,
	fields?: Record<string, unknown>,
): void {
	tokenSetFrontendModeTracing.record({
		name,
		at: Date.now(),
		target: TOKEN_SET_FRONTEND_HOST_TRACE_TARGET,
		span: tokenSetFrontendModeHostSpan,
		level: TracingLevel.Info,
		fields,
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
			tokenSetFrontendModeAuthSnapshotSignal.setValue(slot.value);
			reconcileFrontendModeCrossTabStatus(slot.value);
		} else {
			tokenSetFrontendModeAuthSnapshotSignal.setValue(null);
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
		client.authSnapshot.notify(syncSnapshot),
		client.lastAuthError.notify(syncLastError),
		...(
			Object.keys(tokenSetFrontendModeAuthOperationSignals) as Array<
				keyof typeof tokenSetFrontendModeAuthOperationSignals
			>
		).map((key) => client.authOperations[key].notify(syncOperation(key))),
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
	}).subscribe({
		next: ({ newValue }) => {
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

async function createTokenSetFrontendModeRawClient(): Promise<FrontendOidcModeClient> {
	const redirectUri = buildAbsoluteUrl(TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH);
	const environment = createFrontendOidcModeWebClientEnvironment({
		persistentStoragePrefix: TOKEN_SET_FRONTEND_PERSISTENT_PREFIX,
		sessionStoragePrefix: TOKEN_SET_FRONTEND_SESSION_PREFIX,
		span: tokenSetFrontendModeRootSpan,
		tracing: tokenSetFrontendModeTracing,
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

async function getTokenSetFrontendModeRawClient(): Promise<FrontendOidcModeClient> {
	if (!tokenSetFrontendModeClientPromise) {
		tokenSetFrontendModeClientPromise = createTokenSetFrontendModeRawClient();
	}

	return await tokenSetFrontendModeClientPromise;
}

async function ensureTokenSetFrontendModeClientSubscribed(): Promise<FrontendOidcModeClient> {
	const client = await getTokenSetFrontendModeRawClient();
	ensureTokenSetFrontendModeCrossTabSync(client);

	if (!tokenSetFrontendModeStateUnsubscribe) {
		tokenSetFrontendModeStateUnsubscribe =
			mirrorFrontendModeClientSignals(client);
	}

	return client;
}

const tokenSetFrontendModeReactClient: TokenSetFrontendModeViewClient = {
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
		const outerSubscription = {
			unsubscribe() {
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
		return true;
	},
	async start() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.start();
	},
	dispose() {
		tokenSetFrontendModeStateUnsubscribe?.();
		tokenSetFrontendModeStateUnsubscribe = null;
		tokenSetFrontendModeCrossTabSync?.unsubscribe();
		tokenSetFrontendModeCrossTabSync = null;
		for (const subscription of [
			...tokenSetFrontendModeAuthCheckTriggerSubscriptions.values(),
		]) {
			subscription.unsubscribe();
		}
		tokenSetFrontendModeAuthCheckTriggerSubscriptions.clear();
		tokenSetFrontendModeAuthSnapshotSignal.setValue(null);
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
	[SYMBOL_DISPOSE]() {
		this.dispose();
	},
	async restorePersistedState() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const snapshot = await client.restorePersistedState();
		reconcileFrontendModeCrossTabStatus(snapshot);
		return snapshot;
	},
	async loginWithRedirect(options) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.loginWithRedirect(options);
	},
	async loginWithPopup(options) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		return await client.loginWithPopup(options);
	},
	async refresh() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const snapshot = await client.refreshState();
		reconcileFrontendModeCrossTabStatus(snapshot);
		return snapshot;
	},
	async clearState() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.clearState();
	},
	async logout() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.logout();
	},
};

export async function getTokenSetFrontendModeClient(): Promise<TokenSetFrontendModeViewClient> {
	await ensureTokenSetFrontendModeClientSubscribed();
	return tokenSetFrontendModeReactClient;
}

export async function ensureTokenSetFrontendModeClientReady(): Promise<AuthSnapshot | null> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.start();
	const snapshot = await client.authSnapshot.whenValue();
	reconcileFrontendModeCrossTabStatus(snapshot);
	return snapshot;
}

export async function startTokenSetFrontendModeLogin(
	environment: FoundationEnvironment,
	postAuthRedirectUri = "/",
): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	if (!environment.router) {
		throw new Error(
			"startTokenSetFrontendModeLogin requires an environment with router.",
		);
	}
	await client.loginWithRedirect({
		postAuthRedirectUri,
	});
}

export async function startTokenSetFrontendModePopupLogin(): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.loginWithPopup({
		popupCallbackUrl: buildAbsoluteUrl(
			TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH,
		),
	});
	const snapshot = readFrontendModeSnapshot();
	if (snapshot?.tokens.accessToken) {
		reconcileFrontendModeCrossTabStatus(snapshot);
	}
}

export async function clearTokenSetFrontendModeBrowserState(): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.logout();
}

export function isTokenSetFrontendPopupError(error: unknown): error is Error & {
	code?: string;
	recovery?: string;
} {
	return typeof error === "object" && error !== null && "code" in error;
}

export { TokenSetPopupRelayErrorCode };

export async function tokenSetFrontendModeClientFactory(): Promise<FrontendOidcModeClient> {
	return await ensureTokenSetFrontendModeClientSubscribed();
}
