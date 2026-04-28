import {
	createSignal,
	createTraceTimelineStore,
	readonlySignal,
} from "@securitydept/client";
import { createCrossTabSync, PopupErrorCode } from "@securitydept/client/web";
import type { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { createFrontendOidcModeBrowserClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
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
const tokenSetFrontendModeStateSignal = createSignal<AuthSnapshot | null>(null);
let tokenSetFrontendModeStateUnsubscribe: (() => void) | null = null;
let tokenSetFrontendModePersistentStorageKey: string | null = null;
let tokenSetFrontendModeCrossTabSync: ReturnType<
	typeof createCrossTabSync
> | null = null;

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

function buildAbsoluteUrl(path: string): string {
	return new URL(path, window.location.origin).toString();
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
		onSync: ({ newValue }) => {
			void (async () => {
				const nextCount =
					tokenSetFrontendModeCrossTabStatusSignal.get().syncCount + 1;

				if (newValue === null) {
					await client.clearState({ clearPersisted: false });
					tokenSetFrontendModeCrossTabStatusSignal.set({
						syncCount: nextCount,
						lastEvent: "cleared",
						hasAccessToken: false,
						updatedAt: Date.now(),
					});
					recordFrontendHostTrace(FrontendHostTraceEventType.CrossTabCleared, {
						hasAccessToken: false,
						syncCount: nextCount,
					});
					return;
				}

				const snapshot = await client.restorePersistedState();
				tokenSetFrontendModeCrossTabStatusSignal.set({
					syncCount: nextCount,
					lastEvent: "hydrated",
					hasAccessToken: Boolean(snapshot?.tokens.accessToken),
					updatedAt: Date.now(),
				});
				recordFrontendHostTrace(FrontendHostTraceEventType.CrossTabHydrated, {
					hasAccessToken: Boolean(snapshot?.tokens.accessToken),
					syncCount: nextCount,
				});
			})();
		},
	});
}

async function createTokenSetFrontendModeClient(): Promise<FrontendOidcModeClient> {
	const redirectUri = buildAbsoluteUrl(TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH);
	const materialized = await createFrontendOidcModeBrowserClient({
		configEndpoint: TOKEN_SET_FRONTEND_MODE_CONFIG_PATH,
		redirectUri,
		defaultPostAuthRedirectUri: "/",
		persistentStoragePrefix: TOKEN_SET_FRONTEND_PERSISTENT_PREFIX,
		sessionStoragePrefix: TOKEN_SET_FRONTEND_SESSION_PREFIX,
		traceSink: tokenSetFrontendModeTraceTimeline,
	});
	tokenSetFrontendModePersistentStorageKey =
		materialized.browserPersistentStorageKey;

	return materialized.client;
}

async function ensureTokenSetFrontendModeClientSubscribed(): Promise<FrontendOidcModeClient> {
	const client = await getTokenSetFrontendModeClient();
	ensureTokenSetFrontendModeCrossTabSync(client);

	if (!tokenSetFrontendModeStateUnsubscribe) {
		tokenSetFrontendModeStateSignal.set(client.state.get());
		tokenSetFrontendModeStateUnsubscribe = client.state.subscribe(() => {
			tokenSetFrontendModeStateSignal.set(client.state.get());
		});
	}

	return client;
}

const tokenSetFrontendModeReactClient: TokenSetReactClient = {
	state: readonlySignal(tokenSetFrontendModeStateSignal),
	dispose() {
		tokenSetFrontendModeStateUnsubscribe?.();
		tokenSetFrontendModeStateUnsubscribe = null;
		tokenSetFrontendModeCrossTabSync?.dispose();
		tokenSetFrontendModeCrossTabSync = null;
		tokenSetFrontendModeStateSignal.set(null);
		tokenSetFrontendModeCrossTabStatusSignal.set({
			syncCount: 0,
			lastEvent: "idle",
			hasAccessToken: false,
			updatedAt: null,
		});
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
		tokenSetFrontendModeStateSignal.set(client.state.get());
		return snapshot;
	},
	async handleCallback(callbackUrl) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const result = await client.handleCallback(callbackUrl);
		tokenSetFrontendModeStateSignal.set(client.state.get());
		return result;
	},
	authorizeUrl() {
		throw new Error(
			"Token Set frontend mode requires the app-owned startTokenSetFrontendModeLogin() helper instead of the sync authorizeUrl() contract.",
		);
	},
	authorizationHeader() {
		const accessToken =
			tokenSetFrontendModeStateSignal.get()?.tokens.accessToken;
		return accessToken ? `Bearer ${accessToken}` : null;
	},
	async ensureFreshAuthState(options) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const snapshot = await client.ensureFreshAuthState(options);
		tokenSetFrontendModeStateSignal.set(client.state.get());
		return snapshot;
	},
	async ensureAuthorizationHeader(options) {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const authorization = await client.ensureAuthorizationHeader(options);
		tokenSetFrontendModeStateSignal.set(client.state.get());
		return authorization;
	},
	async refresh() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		const snapshot = await client.refresh();
		tokenSetFrontendModeStateSignal.set(client.state.get());
		return snapshot;
	},
	async clearState() {
		const client = await ensureTokenSetFrontendModeClientSubscribed();
		await client.clearState();
		tokenSetFrontendModeStateSignal.set(client.state.get());
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
	return await client.restorePersistedState();
}

export async function startTokenSetFrontendModeLogin(
	postAuthRedirectUri = "/",
): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.loginWithRedirect({ postAuthRedirectUri });
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
	const snapshot = client.state.get();
	tokenSetFrontendModeStateSignal.set(snapshot);
	if (snapshot?.tokens.accessToken) {
		tokenSetFrontendModeCrossTabStatusSignal.set({
			syncCount: tokenSetFrontendModeCrossTabStatusSignal.get().syncCount,
			lastEvent: "hydrated",
			hasAccessToken: true,
			updatedAt: Date.now(),
		});
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
