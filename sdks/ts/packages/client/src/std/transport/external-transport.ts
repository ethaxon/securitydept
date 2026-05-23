import type {
	ExternalTransportTrait,
	HttpRequest,
	HttpResponse,
} from "../../transport/types";
import {
	createAbortSignalBridge,
	normalizeAbortError,
} from "../cancellation/abort-signal";

export const FetchTransportRedirectKind = {
	Follow: "follow",
	Manual: "manual",
} as const;

export type FetchTransportRedirectKind =
	(typeof FetchTransportRedirectKind)[keyof typeof FetchTransportRedirectKind];

export interface CreateExternalTransportForFetchOptions {
	/**
	 * How to handle HTTP redirects.
	 * - `"follow"`: automatically follow redirects (default fetch behavior)
	 * - `"manual"`: capture redirect responses as-is (needed for fragment-based protocols)
	 */
	redirect?: FetchTransportRedirectKind;
	fetch?: typeof fetch;
	baseUrl?: string | URL;
}

/**
 * Default `ExternalTransportTrait` backed by the global `fetch` API.
 *
 * The caller is responsible for ensuring `fetch` is available in the runtime.
 * No polyfill is injected — see the polyfill strategy in the design guide.
 */
export function createExternalTransportForFetch(
	options: CreateExternalTransportForFetchOptions = {},
): ExternalTransportTrait {
	const redirect = options.redirect ?? FetchTransportRedirectKind.Manual;
	const fetchImpl = options.fetch ?? fetch;
	const baseUrl = options.baseUrl;

	return {
		async execute(request: HttpRequest): Promise<HttpResponse> {
			const requestUrl = baseUrl
				? new URL(request.url, baseUrl).toString()
				: request.url;
			const abortBridge = createAbortSignalBridge(request.cancellationToken);
			const init: RequestInit = {
				method: request.method,
				headers: request.headers,
				redirect,
				signal: abortBridge.signal,
			};

			if (
				request.body !== undefined &&
				request.method !== "GET" &&
				request.method !== "HEAD"
			) {
				init.body =
					typeof request.body === "string"
						? request.body
						: JSON.stringify(request.body);
			}

			try {
				const res = await fetchImpl(requestUrl, init);

				const responseHeaders: Record<string, string> = {};
				res.headers.forEach((value, key) => {
					responseHeaders[key] = value;
				});

				let body: unknown;
				const contentType = res.headers.get("content-type");
				if (contentType?.includes("application/json")) {
					body = await res.json();
				} else if (
					res.status !== 302 &&
					res.status !== 303 &&
					res.status !== 301
				) {
					body = await res.text();
				}

				return {
					status: res.status,
					headers: responseHeaders,
					body,
				};
			} catch (error) {
				throw normalizeAbortError(request.cancellationToken, error);
			} finally {
				abortBridge.dispose();
			}
		},
	};
}
