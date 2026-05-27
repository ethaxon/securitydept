import { type AuthRequirement } from "@securitydept/client";
import {
	type CreateSecureBeforeLoadOptions,
	createSecureBeforeLoad,
	type SecureBeforeLoadContext,
} from "@securitydept/client-react/tanstack-router";
import {
	type ClientQueryOptions,
	type OidcModeClient,
} from "@securitydept/token-set-context-client/registry";

export interface TokenSetTanStackAuthRegistry {
	whenReady(key?: string): Promise<OidcModeClient>;
	clientKeysForOptions(options: ClientQueryOptions): string[];
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
	const client = await resolveTanStackClient(options.registry, selector);
	return client !== null && (await client.isAuthenticated.whenValue());
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

async function resolveTanStackClient(
	registry: TokenSetTanStackAuthRegistry,
	selector: TokenSetTanStackClientSelector | undefined,
): Promise<OidcModeClient | null> {
	if (selector?.key) {
		return await registry.whenReady(selector.key);
	}
	const keys = selector?.query
		? registry.clientKeysForOptions(selector.query)
		: [];
	if (keys.length === 0) {
		return null;
	}
	if (keys.length > 1) {
		return null;
	}
	return await registry.whenReady(keys[0]);
}
