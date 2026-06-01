import {
	type AuthRequirement,
	type ReadableSignalTrait,
} from "@securitydept/client";
import {
	type CreateSecureBeforeLoadOptions,
	createSecureBeforeLoad,
	type SecureBeforeLoadContext,
} from "@securitydept/client-react/tanstack-router";
import {
	type TokenSetClientQueryOptions,
	type TokenSetClientRecord,
} from "@securitydept/token-set-context-client/registry";
import { type TokenSetReactClient } from "../contracts";

export interface TokenSetTanStackAuthRegistry {
	initialize(key: string): Promise<TokenSetReactClient>;
	clientRecordGenForQuery(
		query: TokenSetClientQueryOptions,
	): Generator<
		ReadableSignalTrait<TokenSetClientRecord<TokenSetReactClient>>,
		void
	>;
}

export interface TokenSetTanStackClientSelector {
	key?: string;
	query?: TokenSetClientQueryOptions;
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
	const attributes =
		(requirement as { attributes?: Record<string, unknown> }).attributes ?? {};
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
			requirementKind: (requirement as { kind?: string }).kind,
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
): Promise<TokenSetReactClient | null> {
	if (selector?.key) {
		return await registry.initialize(selector.key);
	}
	const records = selector?.query
		? [...registry.clientRecordGenForQuery(selector.query)]
		: [];
	if (records.length === 0) {
		return null;
	}
	if (records.length > 1) {
		return null;
	}
	const record = records[0]?.get();
	return record ? await registry.initialize(record.meta.clientKey) : null;
}
