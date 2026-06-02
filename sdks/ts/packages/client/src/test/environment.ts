import {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
} from "../environment/create";
import { type FoundationEnvironment } from "../environment/types";
import {
	createProviderIfTokenMissing,
	getSecuritydeptProviderToken,
	notMissingProvider,
	type SecuritydeptProvider,
} from "../injection";
import { TIME_TRAIT_TOKEN, type TimeTrait } from "../scheduling/types";
import {
	type BaseTransportTrait,
	TRANSPORT_TRAIT_TOKEN,
} from "../transport/types";
import { createTimeForTest } from "./time";

export type EnvironmentCreatorOptions = {
	providers?: readonly SecuritydeptProvider[];
};

export type EnvironmentCreator<
	TOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
> = (options: TOptions) => TEnvironment;

export interface CreateEnvironmentForTestOptions
	extends Omit<CreateFoundationEnvironmentOptions, "transport"> {
	transport?: BaseTransportTrait;
	time?: TimeTrait;
}

export type CreateEnvironmentForTestWithBaseOptions<
	TBaseOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
> = Omit<TBaseOptions, "providers" | "transport" | "createBaseEnvironment"> & {
	createBaseEnvironment: EnvironmentCreator<TBaseOptions, TEnvironment>;
	transport?: BaseTransportTrait;
	providers?: readonly SecuritydeptProvider[];
};

export function createEnvironmentForTest(): FoundationEnvironment;
export function createEnvironmentForTest(
	options: CreateEnvironmentForTestOptions,
): FoundationEnvironment;
export function createEnvironmentForTest<
	TBaseOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
>(
	options: CreateEnvironmentForTestWithBaseOptions<TBaseOptions, TEnvironment>,
): TEnvironment;
export function createEnvironmentForTest(
	options:
		| CreateEnvironmentForTestOptions
		| CreateEnvironmentForTestWithBaseOptions<
				EnvironmentCreatorOptions,
				FoundationEnvironment
		  > = {},
): FoundationEnvironment {
	const {
		createBaseEnvironment = createFoundationEnvironment,
		transport,
		providers = [],
		...baseOptions
	} = options as CreateEnvironmentForTestWithBaseOptions<
		EnvironmentCreatorOptions,
		FoundationEnvironment
	> &
		CreateEnvironmentForTestOptions;
	const externalProviderTokens = new Set(
		providers.map((provider) => getSecuritydeptProviderToken(provider)),
	);
	const testProviders: SecuritydeptProvider[] = [
		createProviderIfTokenMissing(
			externalProviderTokens,
			TRANSPORT_TRAIT_TOKEN,
			() => ({
				provide: TRANSPORT_TRAIT_TOKEN,
				useValue: transport ?? createMissingTransportForTest(),
			}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			TIME_TRAIT_TOKEN,
			() => ({
				provide: TIME_TRAIT_TOKEN,
				useValue:
					baseOptions.time ?? createTimeForTest({ initialNow: Date.now() }),
			}),
		),
	].filter(notMissingProvider) as SecuritydeptProvider[];

	return createBaseEnvironment({
		...(baseOptions as unknown as Omit<EnvironmentCreatorOptions, "providers">),
		providers: [...testProviders, ...providers],
	});
}

function createMissingTransportForTest(): BaseTransportTrait {
	return {
		async execute() {
			throw new Error("Test environment transport was not provided.");
		},
	};
}
