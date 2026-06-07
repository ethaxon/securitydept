import {
	type HttpResponse as AngularHttpResponse,
	HttpErrorResponse,
	type HttpHeaders,
} from "@angular/common/http";
import {
	type BaseTransportTrait,
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	ClientErrorSource,
	type HttpRequest,
	type HttpResponse,
	type TraitInputValidator,
	TransportErrorCode,
	throwValidationClientError,
	validateTraitInput,
	type WithTraitInputValidator,
} from "@securitydept/client";
import { type as defineType } from "arktype";
import { firstValueFrom, from, type Observable, takeUntil } from "rxjs";

export interface AngularHttpClientLike {
	request(
		method: string,
		url: string,
		options: {
			body?: unknown;
			headers?: Record<string, string>;
			observe: "response";
			responseType: "text";
		},
	): Observable<AngularHttpResponse<string>>;
}

export interface BaseTransportForAngularCreateOptions {
	httpClient: AngularHttpClientLike;
	baseUrl?: string | URL;
}

export const BaseTransportForAngularCreateOptionsSchema = defineType({
	httpClient: {
		request: "Function",
	},
	baseUrl: "unknown",
});

export function createBaseTransportForAngular(
	options: BaseTransportForAngularCreateOptions &
		WithTraitInputValidator<TraitInputValidator>,
): BaseTransportTrait {
	const resolvedCreateOptions = {
		httpClient: options.httpClient,
		baseUrl: options.baseUrl,
	};
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: BaseTransportForAngularCreateOptionsSchema,
		validator: options.validators,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: TransportErrorCode.InvalidAngularOptions,
				source: "client-angular",
				messagePrefix:
					"createBaseTransportForAngular could not validate transportForAngularCreateOptions",
				failure,
			}),
	});
	const { httpClient, baseUrl } = resolvedCreateOptions;

	return {
		async execute(request: HttpRequest): Promise<HttpResponse> {
			const requestUrl = baseUrl
				? new URL(request.url, baseUrl).toString()
				: request.url;
			const requestOptions = {
				headers: request.headers,
				observe: "response" as const,
				responseType: "text" as const,
				...(request.body !== undefined &&
				request.method !== "GET" &&
				request.method !== "HEAD"
					? {
							body:
								typeof request.body === "string"
									? request.body
									: JSON.stringify(request.body),
						}
					: {}),
			};

			try {
				const responseSource = request.cancellationToken
					? httpClient
							.request(request.method, requestUrl, requestOptions)
							.pipe(takeUntil(from(request.cancellationToken)))
					: httpClient.request(request.method, requestUrl, requestOptions);
				const response = await firstValueFrom(responseSource);
				try {
					return angularResponseToHttpResponse(response);
				} catch (error) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						message: "The HTTP response body could not be decoded",
						code: TransportErrorCode.ResponseDecodeFailed,
						source: ClientErrorSource.Transport,
						cause: error,
					});
				}
			} catch (error) {
				if (error instanceof HttpErrorResponse && error.status !== 0) {
					try {
						return angularErrorResponseToHttpResponse(error);
					} catch (decodeError) {
						throw new ClientError({
							kind: ClientErrorKind.Protocol,
							message: "The HTTP response body could not be decoded",
							code: TransportErrorCode.ResponseDecodeFailed,
							source: ClientErrorSource.Transport,
							cause: decodeError,
						});
					}
				}
				const normalized = normalizeAngularTransportError(
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
		},
	};
}

function angularResponseToHttpResponse(
	response: AngularHttpResponse<string>,
): HttpResponse {
	return {
		status: response.status,
		headers: angularHeadersToRecord(response.headers),
		body: parseAngularResponseBody(
			response.status,
			response.headers,
			response.body,
		),
	};
}

function angularErrorResponseToHttpResponse(
	error: HttpErrorResponse,
): HttpResponse {
	return {
		status: error.status,
		headers: angularHeadersToRecord(error.headers),
		body: parseAngularResponseBody(error.status, error.headers, error.error),
	};
}

function angularHeadersToRecord(headers: HttpHeaders): Record<string, string> {
	const responseHeaders: Record<string, string> = {};
	for (const key of headers.keys()) {
		const value = headers.get(key);
		if (value !== null) {
			responseHeaders[key] = value;
		}
	}
	return responseHeaders;
}

function parseAngularResponseBody(
	status: number,
	headers: HttpHeaders,
	body: unknown,
): unknown {
	const contentType = headers.get("content-type");
	if (contentType?.includes("application/json") && typeof body === "string") {
		return body.length > 0 ? JSON.parse(body) : undefined;
	}
	if (status !== 302 && status !== 303 && status !== 301) {
		return body;
	}
	return undefined;
}

function normalizeAngularTransportError(
	token: CancellationTokenTrait | undefined,
	error: unknown,
): unknown {
	if (!token?.isCancellationRequested) {
		return error;
	}
	return token.cancellationError ?? error;
}
