import type {
	TokenSetBackendOidcClient,
	TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";

export function isTokenSetBackendOidcClient(
	client: TokenSetReactClient,
): client is TokenSetBackendOidcClient {
	return (
		typeof (client as { authorizeUrl?: unknown }).authorizeUrl === "function" &&
		typeof (client as { refresh?: unknown }).refresh === "function" &&
		typeof (client as { clearState?: unknown }).clearState === "function"
	);
}

export function assertTokenSetBackendOidcClient(
	client: TokenSetReactClient,
	context: string,
): asserts client is TokenSetBackendOidcClient {
	if (!isTokenSetBackendOidcClient(client)) {
		throw new Error(`${context} requires a backend-specific token-set client.`);
	}
}
