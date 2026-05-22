import type { AuthGuardClientOption } from "@securitydept/client/auth-coordination";
import type { ClientQueryOptions, OidcModeClient } from "../registry";

export interface TokenSetWebRouterAuthRegistry {
	whenReady(key?: string): Promise<OidcModeClient>;
	clientKeysForOptions(options: ClientQueryOptions): string[];
}

export interface TokenSetWebRouterClientSelector {
	key?: string;
	query?: ClientQueryOptions;
	providerFamily?: string;
}

export interface CreateTokenSetWebRouteAuthCandidateOptions
	extends TokenSetWebRouterClientSelector {
	registry: TokenSetWebRouterAuthRegistry;
	requirementId: string;
	requirementKind: string;
	label?: string;
	attributes?: Record<string, unknown>;
	url?: string | URL | (() => string | URL | undefined);
	checkAuthenticated?: () => boolean;
	onUnauthenticated?: () => boolean | string | Promise<boolean | string>;
}

export function createTokenSetWebRouteAuthCandidate(
	options: CreateTokenSetWebRouteAuthCandidateOptions,
): AuthGuardClientOption {
	let lastEnsureAuthenticated = false;

	return {
		requirementId: options.requirementId,
		requirementKind: options.requirementKind,
		label: options.label,
		attributes: options.attributes,
		checkAuthenticated: () =>
			options.checkAuthenticated?.() ?? lastEnsureAuthenticated,
		onUnauthenticated: async () => {
			const client = await resolveRouterClient(options);
			lastEnsureAuthenticated =
				client !== null && (await client.isAuthenticated.whenValue());
			if (lastEnsureAuthenticated) {
				return true;
			}
			return await Promise.resolve(options.onUnauthenticated?.() ?? false);
		},
	};
}

async function resolveRouterClient(
	options: CreateTokenSetWebRouteAuthCandidateOptions,
): Promise<OidcModeClient | null> {
	if (options.key) {
		return await options.registry.whenReady(options.key);
	}
	const query = options.query ?? {
		requirementKind: options.requirementKind,
		providerFamily: options.providerFamily,
	};
	const keys = options.registry.clientKeysForOptions(query);
	if (keys.length === 0) {
		return null;
	}
	if (keys.length > 1) {
		return null;
	}
	return await options.registry.whenReady(keys[0]);
}
