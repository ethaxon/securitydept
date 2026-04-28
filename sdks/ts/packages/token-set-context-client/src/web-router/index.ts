import type { AuthGuardClientOption } from "@securitydept/client/auth-coordination";
import {
	type EnsureAuthForResourceResult,
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowSource,
} from "../orchestration";
import type {
	ClientQueryOptions,
	EnsureRegistryAuthForResourceOptions,
} from "../registry";

export interface TokenSetWebRouterAuthRegistry {
	ensureAuthForResource(
		options?: EnsureRegistryAuthForResourceOptions,
	): Promise<EnsureAuthForResourceResult | null>;
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
			const result = await options.registry.ensureAuthForResource({
				key: options.key,
				query: options.query,
				source: TokenSetAuthFlowSource.RawWebRouter,
				requirement: {
					id: options.requirementId,
					kind: options.requirementKind,
				},
				providerFamily: options.providerFamily,
				url: resolveRouteUrl(options.url),
				forceRefreshWhenDue: true,
			});
			lastEnsureAuthenticated = isAuthenticatedResourceResult(result);
			if (lastEnsureAuthenticated) {
				return true;
			}
			return await Promise.resolve(options.onUnauthenticated?.() ?? false);
		},
	};
}

function isAuthenticatedResourceResult(
	result: EnsureAuthForResourceResult | null,
): boolean {
	return (
		result?.status === EnsureAuthForResourceStatus.Authenticated ||
		result?.status === EnsureAuthForResourceStatus.AuthorizationHeaderResolved
	);
}

function resolveRouteUrl(
	url: CreateTokenSetWebRouteAuthCandidateOptions["url"],
): string | undefined {
	const value = typeof url === "function" ? url() : url;
	return value instanceof URL ? value.href : value;
}
