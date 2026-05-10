import { createClientEnvironment } from "../runtime/create-runtime";
import type { ClientEnvironment } from "../runtime/types";
import {
	createFetchTransport,
	type FetchTransportOptions,
} from "../transport/fetch-transport";

export interface CreateWebClientEnvironmentDependenciesOptions
	extends Partial<Omit<ClientEnvironment, "transport">> {
	transport?: ClientEnvironment["transport"];
	fetchTransport?: FetchTransportOptions;
}

/**
 * Create a `ClientEnvironment` for browser/Web-capable environments.
 */
export function createWebClientEnvironmentDependencies(
	overrides: CreateWebClientEnvironmentDependenciesOptions = {},
): ClientEnvironment {
	const { fetchTransport, transport, ...environment } = overrides;
	return createClientEnvironment({
		...environment,
		transport: transport ?? createFetchTransport(fetchTransport),
	});
}
