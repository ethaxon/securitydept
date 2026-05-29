import {
	type CreateFoundationEnvironmentOptions,
	createFoundationEnvironment,
	type FoundationEnvironment,
} from "../environment";
import { type BaseTransportTrait } from "../transport";
import {
	createTransportForServer,
	type ServerRequestContext,
} from "./transport";

export interface CreateEnvironmentForServerOptions
	extends Omit<CreateFoundationEnvironmentOptions, "transport"> {
	transport: BaseTransportTrait;
	request: ServerRequestContext;
}

export function createEnvironmentForServer(
	options: CreateEnvironmentForServerOptions,
): FoundationEnvironment {
	const { transport, request, ...foundationOptions } = options;
	return createFoundationEnvironment({
		...foundationOptions,
		transport: createTransportForServer({ transport, request }),
	});
}
