import type {
	ClientEnvironment,
	PageClientEnvironment,
	WebClientEnvironment,
} from "@securitydept/client/web";
import { ClientEnvironmentService } from "@securitydept/client/web";
import { createContext, type ReactNode, useContext, useMemo } from "react";

interface ClientEnvironmentServiceContextValue {
	readClientEnvironment(): ClientEnvironment;
	readWebEnvironment(): WebClientEnvironment;
	readPageEnvironment(): PageClientEnvironment;
	resolveClientEnvironment(): Promise<ClientEnvironment>;
	resolveWebEnvironment(): Promise<WebClientEnvironment>;
	resolvePageEnvironment(): Promise<PageClientEnvironment>;
	reset(): void;
}

const ClientEnvironmentServiceContext =
	createContext<ClientEnvironmentServiceContextValue | null>(null);

export interface ClientEnvironmentServiceProviderProps {
	children?: ReactNode;
	service?: ClientEnvironmentServiceContextValue;
}

export function ClientEnvironmentServiceProvider({
	children,
	service,
}: ClientEnvironmentServiceProviderProps) {
	const resolvedService = useMemo(
		() => service ?? new ClientEnvironmentService(),
		[service],
	);

	return (
		<ClientEnvironmentServiceContext.Provider value={resolvedService}>
			{children}
		</ClientEnvironmentServiceContext.Provider>
	);
}

export function useClientEnvironmentService<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
>(): ClientEnvironmentService<
	TClientEnvironment,
	TWebEnvironment,
	TPageEnvironment
> {
	const service = useContext(ClientEnvironmentServiceContext);
	if (!service) {
		throw new Error(
			"[useClientEnvironmentService] No ClientEnvironmentServiceProvider found in the component tree. Wrap your app or route with <ClientEnvironmentServiceProvider>.",
		);
	}

	return service as ClientEnvironmentService<
		TClientEnvironment,
		TWebEnvironment,
		TPageEnvironment
	>;
}

export function useClientEnvironment<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
>(): TClientEnvironment {
	return useClientEnvironmentService<
		TClientEnvironment,
		TWebEnvironment,
		TPageEnvironment
	>().readClientEnvironment();
}

export function useWebClientEnvironment<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
>(): TWebEnvironment {
	return useClientEnvironmentService<
		TClientEnvironment,
		TWebEnvironment,
		TPageEnvironment
	>().readWebEnvironment();
}

export function usePageClientEnvironment<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
>(): TPageEnvironment {
	return useClientEnvironmentService<
		TClientEnvironment,
		TWebEnvironment,
		TPageEnvironment
	>().readPageEnvironment();
}
