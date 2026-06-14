import {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
	type FoundationEnvironment,
	type SecuritydeptProvider,
} from "@securitydept/client";

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
 * React currently adds no mandatory environment capability. Keeping this layer
 * explicit gives React-specific services a composition-root boundary without
 * coupling their lifetime to the React fiber tree.
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

	return createBaseEnvironment({
		...(baseOptions as Omit<ReactEnvironmentCreatorOptions, "providers">),
		providers,
	});
}
