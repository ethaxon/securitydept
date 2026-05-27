import {
	createSecuritydeptDestroyRef,
	type SecuritydeptProvider as SecuritydeptDependencyProvider,
	SecuritydeptDestroyRef,
	SecuritydeptInjector,
	type SecuritydeptInjectorTrait,
} from "@securitydept/client";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
} from "react";

export const SecuritydeptContext =
	createContext<SecuritydeptInjectorTrait | null>(null);

export interface SecuritydeptProviderProps {
	injector?: SecuritydeptInjectorTrait;
	parentInjector?: SecuritydeptInjectorTrait;
	providers?: readonly SecuritydeptDependencyProvider[];
	autoCreateDestroyRef?: boolean;
	children?: ReactNode;
}

export function SecuritydeptProvider({
	injector,
	parentInjector,
	providers = [],
	autoCreateDestroyRef = true,
	children,
}: SecuritydeptProviderProps) {
	const inheritedInjector = useContext(SecuritydeptContext);
	const destroyRef = useMemo(
		() => (autoCreateDestroyRef ? createSecuritydeptDestroyRef() : null),
		[autoCreateDestroyRef],
	);
	const resolvedInjector = useMemo(() => {
		const destroyRefProviders = destroyRef
			? ([
					{
						provide: SecuritydeptDestroyRef,
						useValue: destroyRef,
					},
				] satisfies readonly SecuritydeptDependencyProvider[])
			: [];

		if (injector) {
			if (destroyRefProviders.length === 0) {
				return injector;
			}

			return SecuritydeptInjector.fromParentInjector(
				injector,
				destroyRefProviders,
			);
		}

		const resolvedParentInjector = parentInjector ?? inheritedInjector;
		const resolvedProviders = [...providers, ...destroyRefProviders];
		if (resolvedParentInjector) {
			return SecuritydeptInjector.fromParentInjector(
				resolvedParentInjector,
				resolvedProviders,
			);
		}

		return SecuritydeptInjector.resolveAndCreate(resolvedProviders);
	}, [destroyRef, inheritedInjector, injector, parentInjector, providers]);

	useEffect(() => {
		if (!destroyRef) {
			return;
		}

		return () => {
			(
				destroyRef as SecuritydeptDestroyRef & { destroy?: () => void }
			).destroy?.();
		};
	}, [destroyRef]);

	return (
		<SecuritydeptContext.Provider value={resolvedInjector}>
			{children}
		</SecuritydeptContext.Provider>
	);
}

export function useSecuritydeptContext(): SecuritydeptInjectorTrait {
	const injector = useContext(SecuritydeptContext);
	if (!injector) {
		throw new Error(
			"[useSecuritydeptContext] No SecuritydeptProvider found in the component tree.",
		);
	}
	return injector;
}
