import {
	type BaseTransportTrait,
	type HttpRequest,
	type HttpResponse,
} from "../transport/types";

export interface TransportForTestRoute {
	predicate: (request: HttpRequest) => boolean;
	handler: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;
}

export interface TransportForTestCreateOptions {
	routes?: readonly TransportForTestRoute[];
	fallback?: HttpResponse;
}

export interface TestTransportTrait extends BaseTransportTrait {
	on(
		predicate: (request: HttpRequest) => boolean,
		handler: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>,
	): this;
	onRequest(method: string, urlPrefix: string, response: HttpResponse): this;
	setFallback(response: HttpResponse): this;
	reset(): void;
	readonly history: readonly HttpRequest[];
}

export function createTransportForTest(
	options: TransportForTestCreateOptions = {},
): TestTransportTrait {
	const routes = [...(options.routes ?? [])];
	const history: HttpRequest[] = [];
	let fallback = options.fallback ?? createNotFoundResponseForTest();
	return {
		on(predicate, handler) {
			routes.push({ predicate, handler });
			return this;
		},
		onRequest(method, urlPrefix, response) {
			return this.on(
				(request) =>
					request.method.toUpperCase() === method.toUpperCase() &&
					request.url.startsWith(urlPrefix),
				() => response,
			);
		},
		setFallback(response) {
			fallback = response;
			return this;
		},
		reset() {
			routes.length = 0;
			history.length = 0;
		},
		get history() {
			return history;
		},
		async execute(request) {
			history.push(request);
			for (const route of routes) {
				if (route.predicate(request)) {
					return route.handler(request);
				}
			}
			return fallback;
		},
	};
}

function createNotFoundResponseForTest(): HttpResponse {
	return {
		status: 404,
		headers: {},
		body: { error: "No matching test transport route" },
	};
}
