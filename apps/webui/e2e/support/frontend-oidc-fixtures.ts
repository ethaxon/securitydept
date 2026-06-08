import { type Page } from "@playwright/test";
import { FrontendOidcModeContextSource } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	frontendCallbackPath,
	frontendCallbackUrl,
	frontendPlaygroundPath,
	oidcClientId,
	oidcIssuerUrl,
	webuiBaseUrl,
} from "./constants.ts";

const nativeWebSessionPrefix = "securitydept.web.client:";
const pendingStateKeyPrefix = "securitydept.frontend_oidc.pending";

export interface SeedFrontendOidcPendingStateOptions {
	state: string;
	createdAt?: number;
	issuer?: string;
	clientId?: string;
	redirectUri?: string;
	postAuthRedirectUri?: string;
	nonce?: string;
	codeVerifier?: string;
}

function resolvePendingStorageKey(state: string): string {
	return `${nativeWebSessionPrefix}${pendingStateKeyPrefix}:${state}`;
}

export function createFrontendModeCallbackUrl(state: string): string {
	const url = new URL(frontendCallbackPath, webuiBaseUrl);
	url.searchParams.set("code", "auth-code");
	url.searchParams.set("state", state);
	return url.toString();
}

export async function seedFrontendOidcPendingState(
	page: Page,
	options: SeedFrontendOidcPendingStateOptions,
): Promise<{ callbackUrl: string; storageKey: string }> {
	const storageKey = resolvePendingStorageKey(options.state);
	const pendingState = {
		codeVerifier: options.codeVerifier ?? "pkce-verifier",
		state: options.state,
		contextSource: FrontendOidcModeContextSource.Client,
		issuer: options.issuer ?? oidcIssuerUrl,
		clientId: options.clientId ?? oidcClientId,
		redirectUri: options.redirectUri ?? frontendCallbackUrl,
		nonce: options.nonce ?? `nonce-${options.state}`,
		postAuthRedirectUri: options.postAuthRedirectUri ?? frontendPlaygroundPath,
		createdAt: options.createdAt ?? Date.now(),
	};

	await page.addInitScript(
		({ key, value }) => {
			window.sessionStorage.setItem(key, JSON.stringify(value));
		},
		{ key: storageKey, value: pendingState },
	);

	return {
		callbackUrl: createFrontendModeCallbackUrl(options.state),
		storageKey,
	};
}
