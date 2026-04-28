import type { AuthRequirement } from "@securitydept/client/auth-coordination";
import {
	type CreateSecureBeforeLoadOptions,
	createSecureBeforeLoad,
	type SecureBeforeLoadContext,
} from "@securitydept/client-react/tanstack-router";
import {
	type EnsureAuthForResourceResult,
	EnsureAuthForResourceStatus,
	TokenSetAuthFlowSource,
} from "@securitydept/token-set-context-client/orchestration";
import type {
	ClientQueryOptions,
	EnsureRegistryAuthForResourceOptions,
} from "@securitydept/token-set-context-client/registry";

export interface TokenSetTanStackAuthRegistry {
	ensureAuthForResource(
		options?: EnsureRegistryAuthForResourceOptions,
	): Promise<EnsureAuthForResourceResult | null>;
}

export interface TokenSetTanStackClientSelector {
	key?: string;
	query?: ClientQueryOptions;
	providerFamily?: string;
}

export interface CreateTokenSetSecureBeforeLoadOptions
	extends Omit<CreateSecureBeforeLoadOptions, "checkAuthenticated"> {
	registry: TokenSetTanStackAuthRegistry;
	resolveClient?: (
		requirement: AuthRequirement,
		context: SecureBeforeLoadContext,
	) => TokenSetTanStackClientSelector | undefined;
}

export function createTokenSetSecureBeforeLoad(
	options: CreateTokenSetSecureBeforeLoadOptions,
): (ctx: SecureBeforeLoadContext) => void | Promise<void> {
	return (ctx) =>
		createSecureBeforeLoad({
			...options,
			checkAuthenticated: (requirement) =>
				ensureTanStackRequirement(options, requirement, ctx),
		})(ctx);
}

async function ensureTanStackRequirement(
	options: CreateTokenSetSecureBeforeLoadOptions,
	requirement: AuthRequirement,
	context: SecureBeforeLoadContext,
): Promise<boolean> {
	const selector =
		options.resolveClient?.(requirement, context) ??
		defaultClientSelector(requirement);
	const result = await options.registry.ensureAuthForResource({
		key: selector?.key,
		query: selector?.query,
		source: TokenSetAuthFlowSource.TanStackBeforeLoad,
		requirement: { id: requirement.id, kind: requirement.kind },
		providerFamily: selector?.providerFamily,
		url: context.location.href,
		forceRefreshWhenDue: true,
	});
	return isAuthenticatedResourceResult(result);
}

function defaultClientSelector(
	requirement: AuthRequirement,
): TokenSetTanStackClientSelector | undefined {
	const attributes = requirement.attributes ?? {};
	return {
		key:
			typeof attributes.clientKey === "string"
				? attributes.clientKey
				: undefined,
		providerFamily:
			typeof attributes.providerFamily === "string"
				? attributes.providerFamily
				: undefined,
		query: {
			requirementKind: requirement.kind,
			providerFamily:
				typeof attributes.providerFamily === "string"
					? attributes.providerFamily
					: undefined,
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
