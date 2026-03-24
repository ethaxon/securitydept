import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "@securitydept/client";

interface FakeRoute {
	predicate: (request: HttpRequest) => boolean;
	handler: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;
}

/**
 * Fake HTTP transport for testing.
 * Responses are configured via `on()` — matched in registration order.
 */
export class FakeTransport implements HttpTransport {
	private readonly _routes: FakeRoute[] = [];
	private readonly _history: HttpRequest[] = [];
	private _fallback: HttpResponse = {
		status: 404,
		headers: {},
		body: { error: "No matching fake route" },
	};

	/** Register a route handler. */
	on(
		predicate: (request: HttpRequest) => boolean,
		handler: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>,
	): this {
		this._routes.push({ predicate, handler });
		return this;
	}

	/** Convenience: match by method + URL prefix. */
	onRequest(method: string, urlPrefix: string, response: HttpResponse): this {
		return this.on(
			(r) =>
				r.method.toUpperCase() === method.toUpperCase() &&
				r.url.startsWith(urlPrefix),
			() => response,
		);
	}

	/** Set fallback response for unmatched requests. */
	setFallback(response: HttpResponse): this {
		this._fallback = response;
		return this;
	}

	/** All requests that have been executed. */
	get history(): readonly HttpRequest[] {
		return this._history;
	}

	/** Clear route configuration and history. */
	reset(): void {
		this._routes.length = 0;
		this._history.length = 0;
	}

	async execute(request: HttpRequest): Promise<HttpResponse> {
		this._history.push(request);

		for (const route of this._routes) {
			if (route.predicate(request)) {
				return route.handler(request);
			}
		}

		return this._fallback;
	}
}
