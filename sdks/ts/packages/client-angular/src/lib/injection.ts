import {
	DestroyRef,
	type EnvironmentProviders,
	InjectionToken,
	inject,
	makeEnvironmentProviders,
} from "@angular/core";
import {
	createSecuritydeptDestroyRef,
	SecuritydeptDestroyRef,
	SecuritydeptInjector,
	type SecuritydeptProvider,
} from "@securitydept/client";

export const SECURITYDEPT_INJECTOR = new InjectionToken<SecuritydeptInjector>(
	"SECURITYDEPT_INJECTOR",
);

export interface ProvideSecuritydeptOptions {
	readonly providers?: readonly SecuritydeptProvider[];
	readonly autoCreateDestroyRef?: boolean;
}

export function provideSecuritydept(
	options: ProvideSecuritydeptOptions = {},
): EnvironmentProviders {
	return makeEnvironmentProviders([
		{
			provide: SECURITYDEPT_INJECTOR,
			useFactory: (): SecuritydeptInjector => {
				const parentInjector =
					inject(SECURITYDEPT_INJECTOR, {
						optional: true,
						skipSelf: true,
					}) ?? undefined;
				const angularDestroyRef = inject(DestroyRef);
				const securitydeptDestroyRef =
					options.autoCreateDestroyRef === false
						? null
						: createSecuritydeptDestroyRef();
				if (securitydeptDestroyRef) {
					angularDestroyRef.onDestroy(() => securitydeptDestroyRef.dispose());
				}

				const providers = [
					...(options.providers ?? []),
					...(securitydeptDestroyRef
						? [
								{
									provide: SecuritydeptDestroyRef,
									useValue: securitydeptDestroyRef,
								} satisfies SecuritydeptProvider,
							]
						: []),
				];
				return parentInjector
					? SecuritydeptInjector.fromParentInjector(parentInjector, providers)
					: SecuritydeptInjector.resolveAndCreate(providers);
			},
		},
	]);
}
