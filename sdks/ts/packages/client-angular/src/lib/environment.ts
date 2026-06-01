import { DOCUMENT } from "@angular/common";
import { HttpClient } from "@angular/common/http";
import {
	InjectionToken,
	Injector,
	Optional,
	type Provider,
} from "@angular/core";
import { Router } from "@angular/router";
import {
	createProviderIfTokenMissing,
	type FoundationEnvironment,
	getSecuritydeptProviderToken,
	notMissingProvider,
	ROUTER_TRAIT_TOKEN,
	type SecuritydeptProvider,
	TRANSPORT_TRAIT_TOKEN,
} from "@securitydept/client";
import {
	type CreateRouterForAngularOptions,
	createRouterForAngular,
} from "./router";
import {
	type BaseTransportForAngularCreateOptions,
	createBaseTransportForAngular,
} from "./transport";

export const ENVIRONMENT = new InjectionToken<FoundationEnvironment>(
	"ENVIRONMENT",
);

export const ENVIRONMENT_PROVIDER = new InjectionToken<SecuritydeptProvider>(
	"ENVIRONMENT_PROVIDER",
);

export type EnvironmentCreatorOptions = {
	providers?: readonly SecuritydeptProvider[];
};

export type EnvironmentCreator<
	TOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
> = (options: TOptions) => TEnvironment;

export type CreateEnvironmentForAngularOptions<
	TBaseOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
> = Omit<
	TBaseOptions,
	| "providers"
	| "routerForAngularCreateOptions"
	| "transportForAngularCreateOptions"
	| "injectorForAngularProvider"
	| "createBaseEnvironment"
> & {
	createBaseEnvironment: EnvironmentCreator<TBaseOptions, TEnvironment>;
	routerForAngularCreateOptions: CreateRouterForAngularOptions;
	transportForAngularCreateOptions: BaseTransportForAngularCreateOptions;
	injectorForAngularProvider?: Injector;
	providers?: readonly SecuritydeptProvider[];
};

export type ProvideEnvironmentOptions<
	TBaseOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
> = Omit<
	CreateEnvironmentForAngularOptions<TBaseOptions, TEnvironment>,
	| "routerForAngularCreateOptions"
	| "transportForAngularCreateOptions"
	| "injectorForAngularProvider"
	| "providers"
> & {
	routerForAngularCreateOptions?: Partial<CreateRouterForAngularOptions>;
	transportForAngularCreateOptions?: Partial<BaseTransportForAngularCreateOptions>;
	providers?: readonly SecuritydeptProvider[];
};

export function createEnvironmentForAngular<
	TBaseOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
>(
	options: CreateEnvironmentForAngularOptions<TBaseOptions, TEnvironment>,
): TEnvironment {
	const {
		createBaseEnvironment,
		routerForAngularCreateOptions,
		transportForAngularCreateOptions,
		injectorForAngularProvider,
		providers = [],
		...baseOptions
	} = options;
	const externalProviderTokens = new Set(
		providers.map((provider) => getSecuritydeptProviderToken(provider)),
	);
	const angularProviders: SecuritydeptProvider[] = [
		createProviderIfTokenMissing(
			externalProviderTokens,
			ROUTER_TRAIT_TOKEN,
			() => ({
				provide: ROUTER_TRAIT_TOKEN,
				useValue: createRouterForAngular(routerForAngularCreateOptions),
			}),
		),
		createProviderIfTokenMissing(
			externalProviderTokens,
			TRANSPORT_TRAIT_TOKEN,
			() => ({
				provide: TRANSPORT_TRAIT_TOKEN,
				useValue: createBaseTransportForAngular(
					transportForAngularCreateOptions,
				),
			}),
		),
		injectorForAngularProvider
			? createProviderIfTokenMissing(externalProviderTokens, Injector, () => ({
					provide: Injector,
					useValue: injectorForAngularProvider,
				}))
			: null,
	].filter(notMissingProvider) as SecuritydeptProvider[];

	return createBaseEnvironment({
		...(baseOptions as unknown as Omit<TBaseOptions, "providers">),
		providers: [...angularProviders, ...providers],
	} as unknown as TBaseOptions);
}

export function provideEnvironment<
	TBaseOptions extends EnvironmentCreatorOptions,
	TEnvironment extends FoundationEnvironment,
>(options: ProvideEnvironmentOptions<TBaseOptions, TEnvironment>): Provider[] {
	return [
		{
			provide: ENVIRONMENT,
			useFactory: (
				router: Router,
				document: Document | null,
				httpClient: HttpClient,
				injector: Injector,
				providers: readonly SecuritydeptProvider[] | null,
			) =>
				createEnvironmentForAngular({
					...options,
					routerForAngularCreateOptions: {
						router,
						document,
						...options.routerForAngularCreateOptions,
					},
					transportForAngularCreateOptions: {
						httpClient,
						...options.transportForAngularCreateOptions,
					},
					injectorForAngularProvider: injector,
					providers: [...(options.providers ?? []), ...(providers ?? [])],
				} as unknown as CreateEnvironmentForAngularOptions<
					TBaseOptions,
					TEnvironment
				>),
			deps: [
				Router,
				[new Optional(), DOCUMENT],
				HttpClient,
				Injector,
				[new Optional(), ENVIRONMENT_PROVIDER],
			],
		},
	];
}

export function provideEnvironmentProvider(
	provider: SecuritydeptProvider,
): Provider {
	return {
		provide: ENVIRONMENT_PROVIDER,
		useValue: provider,
		multi: true,
	};
}
