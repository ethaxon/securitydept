import { type as defineType } from "arktype";
import { ClientError, ClientErrorKind, ClientErrorSource } from "../../errors";
import {
	type BaseTransportTrait,
	type HttpRequest,
	type HttpResponse,
	TransportErrorCode,
} from "../../transport/types";
import {
	type TraitInputValidator,
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "../../validation";
import {
	cancellationTokenToAbortSignal,
	normalizeAbortError,
} from "../cancellation/abort-signal";

export const FetchTransportRedirectKind = {
	Follow: "follow",
	Manual: "manual",
} as const;

export type FetchTransportRedirectKind =
	(typeof FetchTransportRedirectKind)[keyof typeof FetchTransportRedirectKind];

export interface BaseTransportForStdFetchCreateOptions {
	redirect?: FetchTransportRedirectKind;
	fetch?: typeof fetch;
	baseUrl?: string | URL;
}

export const BaseTransportForStdFetchCreateOptionsSchema = defineType({
	redirect: '"follow" | "manual"',
	fetch: "Function",
	baseUrl: "unknown",
});

/**
 * Default `BaseTransportTrait` backed by the global `fetch` API.
 *
 * The caller is responsible for ensuring `fetch` is available in the runtime.
 * No polyfill is injected.
 */
export function createBaseTransportForStdFetch(
	options: BaseTransportForStdFetchCreateOptions &
		WithTraitInputValidator<TraitInputValidator> = {},
): BaseTransportTrait {
	const { validators, ...createOptions } = options;
	const resolvedCreateOptions = {
		redirect: createOptions.redirect ?? FetchTransportRedirectKind.Manual,
		fetch: createOptions.fetch ?? fetch,
		baseUrl: createOptions.baseUrl,
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: BaseTransportForStdFetchCreateOptionsSchema,
		validator: validators,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: TransportErrorCode.InvalidStdFetchOptions,
				source: "transport",
				messagePrefix:
					"createBaseTransportForStdFetch could not validate transportForStdFetchCreateOptions",
				failure,
			}),
	});
	const redirect = resolvedCreateOptions.redirect;
	const fetchImpl = resolvedCreateOptions.fetch;
	const baseUrl = resolvedCreateOptions.baseUrl;

	return {
		async execute(request: HttpRequest): Promise<HttpResponse> {
			const requestUrl = baseUrl
				? new URL(request.url, baseUrl).toString()
				: request.url;
			const abortBridge = cancellationTokenToAbortSignal(
				request.cancellationToken,
			);
			const init: RequestInit = {
				method: request.method,
				headers: request.headers,
				redirect,
				signal: abortBridge?.signal,
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
				let res: Response;
				try {
					res = await fetchImpl(requestUrl, init);
				} catch (error) {
					const normalized = normalizeAbortError(
						request.cancellationToken,
						error,
					);
					if (normalized instanceof ClientError) {
						throw normalized;
					}
					throw new ClientError({
						kind: ClientErrorKind.Transport,
						message: "The HTTP request could not reach the remote service",
						code: TransportErrorCode.RequestFailed,
						source: ClientErrorSource.Transport,
						retryable: true,
						cause: error,
					});
				}

				const responseHeaders: Record<string, string> = {};
				res.headers.forEach((value, key) => {
					responseHeaders[key] = value;
				});

				let body: unknown;
				try {
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
				} catch (error) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						message: "The HTTP response body could not be decoded",
						code: TransportErrorCode.ResponseDecodeFailed,
						source: ClientErrorSource.Transport,
						cause: error,
					});
				}

				return {
					status: res.status,
					headers: responseHeaders,
					body,
				};
			} finally {
				abortBridge?.dispose();
			}
		},
	};
}
