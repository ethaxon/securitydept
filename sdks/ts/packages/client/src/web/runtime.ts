import { createRuntime } from "../runtime/create-runtime";
import type { ClientRuntime } from "../runtime/types";
import {
	createFetchTransport,
	type FetchTransportOptions,
} from "../transport/fetch-transport";

export interface CreateWebRuntimeOptions
	extends Partial<Omit<ClientRuntime, "transport">> {
	transport?: ClientRuntime["transport"];
	fetchTransport?: FetchTransportOptions;
}

/**
 * Create a `ClientRuntime` for browser/Web-capable environments.
 */
export function createWebRuntime(
	overrides: CreateWebRuntimeOptions = {},
): ClientRuntime {
	const { fetchTransport, transport, ...runtime } = overrides;
	return createRuntime({
		...runtime,
		transport: transport ?? createFetchTransport(fetchTransport),
	});
}
