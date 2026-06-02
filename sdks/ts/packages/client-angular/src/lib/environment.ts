import { HttpClient } from "@angular/common/http";
import {
	DestroyRef,
	InjectionToken,
	Injector,
	Optional,
	type Provider,
} from "@angular/core";
import { Router } from "@angular/router";
import {
	createProviderIfTokenMissing,
	createSecuritydeptDestroyRef,
	type FoundationEnvironment,
	getSecuritydeptProviderToken,
	notMissingProvider,
	ROUTER_TRAIT_TOKEN,
	SecuritydeptDestroyRef,
	type SecuritydeptProvider,
	TRANSPORT_TRAIT_TOKEN,
} from "@securitydept/client";
import {
	type ProvideSecuritydeptOptions,
	SECURITYDEPT_INJECTOR,
} from "./injection";
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
> &
	ProvideSecuritydeptOptions & {
		routerForAngularCreateOptions?: Partial<CreateRouterForAngularOptions>;
		transportForAngularCreateOptions?: Partial<BaseTransportForAngularCreateOptions>;
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
				httpClient: HttpClient,
				injector: Injector,
				destroyRef: DestroyRef,
				providers: readonly SecuritydeptProvider[] | null,
			) => {
				const {
					autoCreateDestroyRef,
					providers: optionProviders,
					...environmentOptions
				} = options;
				const securitydeptDestroyRef =
					autoCreateDestroyRef === false
						? null
						: createSecuritydeptDestroyRef();
				if (securitydeptDestroyRef) {
					destroyRef.onDestroy(() => securitydeptDestroyRef.dispose());
				}
				const environmentProviders = [
					...(optionProviders ?? []),
					...(providers ?? []),
					...(securitydeptDestroyRef
						? [
								{
									provide: SecuritydeptDestroyRef,
									useValue: securitydeptDestroyRef,
								} satisfies SecuritydeptProvider,
							]
						: []),
				];
				return createEnvironmentForAngular({
					...environmentOptions,
					routerForAngularCreateOptions: {
						router,
						...environmentOptions.routerForAngularCreateOptions,
					},
					transportForAngularCreateOptions: {
						httpClient,
						...environmentOptions.transportForAngularCreateOptions,
					},
					injectorForAngularProvider: injector,
					providers: environmentProviders,
				} as unknown as CreateEnvironmentForAngularOptions<
					TBaseOptions,
					TEnvironment
				>);
			},
			deps: [
				Router,
				HttpClient,
				Injector,
				DestroyRef,
				[new Optional(), ENVIRONMENT_PROVIDER],
			],
		},
		{
			provide: SECURITYDEPT_INJECTOR,
			useFactory: (environment: FoundationEnvironment) => environment.injector,
			deps: [ENVIRONMENT],
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
