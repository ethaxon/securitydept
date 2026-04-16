import { createSignal, readonlySignal } from "@securitydept/client";
import {
	createLocalStorageStore,
	createSessionStorageStore,
} from "@securitydept/client/persistence/web";
import { createWebRuntime } from "@securitydept/client/web";
import type { FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	ConfigProjectionSourceKind,
	createFrontendOidcModeClient,
	resolveConfigProjection,
} from "@securitydept/token-set-context-client/frontend-oidc-mode";
import type { AuthSnapshot } from "@securitydept/token-set-context-client/orchestration";
import type { TokenSetReactClient } from "@securitydept/token-set-context-client-react";
import {
	TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	TOKEN_SET_FRONTEND_MODE_CONFIG_PATH,
} from "@/lib/tokenSetConfig";

const TOKEN_SET_FRONTEND_PERSISTENT_PREFIX =
	"securitydept.webui.token-set-frontend:persistent:";
const TOKEN_SET_FRONTEND_SESSION_PREFIX =
	"securitydept.webui.token-set-frontend:session:";

let tokenSetFrontendModeClientPromise: Promise<FrontendOidcModeClient> | null =
	null;
const tokenSetFrontendModeStateSignal = createSignal<AuthSnapshot | null>(null);
let tokenSetFrontendModeStateUnsubscribe: (() => void) | null = null;

function buildAbsoluteUrl(path: string): string {
	return new URL(path, window.location.origin).toString();
}

async function createTokenSetFrontendModeClient(): Promise<FrontendOidcModeClient> {
	const redirectUri = buildAbsoluteUrl(TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH);
	const resolved = await resolveConfigProjection([
		{
			kind: ConfigProjectionSourceKind.Network,
			fetch: async () => {
				const url = new URL(
					buildAbsoluteUrl(TOKEN_SET_FRONTEND_MODE_CONFIG_PATH),
				);
				url.searchParams.set("redirect_uri", redirectUri);
				const response = await fetch(url.toString());
				if (!response.ok) {
					throw new Error(
						`Config projection fetch failed: ${response.status} ${response.statusText}`,
					);
				}
				return response.json();
			},
			overrides: {
				redirectUri,
				defaultPostAuthRedirectUri: "/",
			},
		},
	]);
	const runtime = createWebRuntime({
		persistentStore: createLocalStorageStore(
			TOKEN_SET_FRONTEND_PERSISTENT_PREFIX,
		),
		sessionStore: createSessionStorageStore(TOKEN_SET_FRONTEND_SESSION_PREFIX),
	});

	return createFrontendOidcModeClient(resolved.config, runtime);
}

async function ensureTokenSetFrontendModeClientSubscribed(): Promise<FrontendOidcModeClient> {
	const client = await getTokenSetFrontendModeClient();

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
		tokenSetFrontendModeStateSignal.set(null);
		const clientPromise = tokenSetFrontendModeClientPromise;
		tokenSetFrontendModeClientPromise = null;
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

export async function clearTokenSetFrontendModeBrowserState(): Promise<void> {
	const client = await ensureTokenSetFrontendModeClientSubscribed();
	await client.clearState();
}

export function tokenSetFrontendModeClientFactory(): TokenSetReactClient {
	return tokenSetFrontendModeReactClient;
}
