import { type BaseTransportTrait } from "../transport";

export interface ServerRequestContext {
	headers: Record<string, string>;
}

export interface CreateTransportForServerOptions {
	transport: BaseTransportTrait;
	request: ServerRequestContext;
}

export function createTransportForServer(
	options: CreateTransportForServerOptions,
): BaseTransportTrait {
	return {
		async execute(request) {
			return await options.transport.execute({
				...request,
				headers: {
					...options.request.headers,
					...request.headers,
				},
			});
		},
	};
}
