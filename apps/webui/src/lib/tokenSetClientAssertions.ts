import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";

export type TokenSetBackendOidcClient = BaseOidcModeClient & {
	authorizeUrl(): string;
	refreshState(): Promise<unknown>;
	clearState(): Promise<unknown>;
	logout(): Promise<void>;
};

export function isTokenSetBackendOidcClient(
	client: BaseOidcModeClient,
): client is TokenSetBackendOidcClient {
	return (
		typeof (client as { authorizeUrl?: unknown }).authorizeUrl === "function" &&
		typeof (client as { refreshState?: unknown }).refreshState === "function" &&
		typeof (client as { clearState?: unknown }).clearState === "function" &&
		typeof (client as { logout?: unknown }).logout === "function"
	);
}

export function assertTokenSetBackendOidcClient(
	client: BaseOidcModeClient,
	context: string,
): asserts client is TokenSetBackendOidcClient {
	if (!isTokenSetBackendOidcClient(client)) {
		throw new Error(`${context} requires a backend-specific token-set client.`);
	}
}
