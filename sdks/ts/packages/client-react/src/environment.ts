import {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
	type FoundationEnvironment,
	getSecuritydeptProviderToken,
	type SecuritydeptProvider,
} from "@securitydept/client";
import { provideQueryStore, QueryStore } from "./query-store";

export type ReactEnvironmentCreatorOptions = {
	providers?: readonly SecuritydeptProvider[];
};

export type ReactEnvironmentCreator<
	TOptions extends ReactEnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
> = (options: TOptions) => TEnvironment;

export interface CreateEnvironmentForReactOptions
	extends CreateFoundationEnvironmentOptions {}

export type CreateEnvironmentForReactWithBaseOptions<
	TBaseOptions extends ReactEnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
> = Omit<TBaseOptions, "providers" | "createBaseEnvironment"> & {
	createBaseEnvironment: ReactEnvironmentCreator<TBaseOptions, TEnvironment>;
	providers?: readonly SecuritydeptProvider[];
};

export function createEnvironmentForReact(): FoundationEnvironment;
export function createEnvironmentForReact(
	options: CreateEnvironmentForReactOptions,
): FoundationEnvironment;
export function createEnvironmentForReact<
	TBaseOptions extends ReactEnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
>(
	options: CreateEnvironmentForReactWithBaseOptions<TBaseOptions, TEnvironment>,
): TEnvironment;
/**
 * Compose React-owned providers over a host or foundation environment creator.
 *
 * React services are owned by the environment rather than the React fiber tree.
 */
export function createEnvironmentForReact(
	options:
		| CreateEnvironmentForReactOptions
		| CreateEnvironmentForReactWithBaseOptions<
				ReactEnvironmentCreatorOptions,
				FoundationEnvironment
		  > = {},
): FoundationEnvironment {
	const {
		createBaseEnvironment = createFoundationEnvironment,
		providers = [],
		...baseOptions
	} = options as CreateEnvironmentForReactWithBaseOptions<
		ReactEnvironmentCreatorOptions,
		FoundationEnvironment
	> &
		CreateEnvironmentForReactOptions;
	const providerTokens = new Set(
		providers.map((provider) => getSecuritydeptProviderToken(provider)),
	);
	const reactProviders = providerTokens.has(QueryStore)
		? providers
		: [...provideQueryStore(), ...providers];

	return createBaseEnvironment({
		...(baseOptions as Omit<ReactEnvironmentCreatorOptions, "providers">),
		providers: reactProviders,
	});
}
