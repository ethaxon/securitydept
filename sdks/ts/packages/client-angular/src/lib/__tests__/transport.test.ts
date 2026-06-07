import {
	HttpErrorResponse,
	HttpHeaders,
	HttpResponse,
} from "@angular/common/http";
import {
	ClientErrorKind,
	createCancellationTokenSource,
	TransportErrorCode,
} from "@securitydept/client";
import { Observable, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
	type AngularHttpClientLike,
	createBaseTransportForAngular,
} from "../transport";

describe("Angular base transport adapter", () => {
	it("executes requests through Angular HttpClient", async () => {
		const request = vi.fn(() =>
			of(
				new HttpResponse({
					status: 200,
					headers: new HttpHeaders({ "content-type": "application/json" }),
					body: JSON.stringify({ ok: true }),
				}),
			),
		);
		const transport = createBaseTransportForAngular({
			httpClient: { request },
			baseUrl: "https://api.example.com/root/",
		});

		const response = await transport.execute({
			url: "users",
			method: "POST",
			headers: { authorization: "Bearer token" },
			body: { name: "Ada" },
		});

		expect(request).toHaveBeenCalledWith(
			"POST",
			"https://api.example.com/root/users",
			{
				headers: { authorization: "Bearer token" },
				observe: "response",
				responseType: "text",
				body: JSON.stringify({ name: "Ada" }),
			},
		);
		expect(response).toEqual({
			status: 200,
			headers: { "content-type": "application/json" },
			body: { ok: true },
		});
	});

	it("returns text responses without JSON parsing", async () => {
		const transport = createBaseTransportForAngular({
			httpClient: {
				request: () =>
					of(
						new HttpResponse({
							status: 200,
							headers: new HttpHeaders({ "content-type": "text/plain" }),
							body: "plain",
						}),
					),
			},
		});

		await expect(
			transport.execute({
				url: "/text",
				method: "GET",
				headers: {},
			}),
		).resolves.toEqual({
			status: 200,
			headers: { "content-type": "text/plain" },
			body: "plain",
		});
	});

	it("maps Angular HTTP error responses to transport responses", async () => {
		const transport = createBaseTransportForAngular({
			httpClient: {
				request: () =>
					new Observable<HttpResponse<string>>((subscriber) => {
						subscriber.error(
							new HttpErrorResponse({
								status: 401,
								headers: new HttpHeaders({
									"content-type": "application/json",
								}),
								error: JSON.stringify({ error: "unauthorized" }),
							}),
						);
					}),
			},
		});

		await expect(
			transport.execute({
				url: "/private",
				method: "GET",
				headers: {},
			}),
		).resolves.toEqual({
			status: 401,
			headers: { "content-type": "application/json" },
			body: { error: "unauthorized" },
		});
	});

	it("cancels the Angular request subscription when the cancellation token fires", async () => {
		const cancellationSource = createCancellationTokenSource();
		const unsubscribe = vi.fn();
		const transport = createBaseTransportForAngular({
			httpClient: {
				request: () =>
					new Observable<HttpResponse<string>>(() => {
						return unsubscribe;
					}),
			},
		});
		const requestPromise = transport.execute({
			url: "/slow",
			method: "GET",
			headers: {},
			cancellationToken: cancellationSource.token,
		});

		cancellationSource.cancel(new Error("stopped"));

		await expect(requestPromise).rejects.toMatchObject({
			kind: ClientErrorKind.Cancelled,
			code: "client.cancelled",
			cause: expect.any(Error),
		});
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it("maps Angular network failures to transport errors", async () => {
		const cause = new Error("network failed");
		const transport = createBaseTransportForAngular({
			httpClient: {
				request: () =>
					new Observable<HttpResponse<string>>((subscriber) => {
						subscriber.error(
							new HttpErrorResponse({ status: 0, error: cause }),
						);
					}),
			},
		});
		await expect(
			transport.execute({ url: "/network", method: "GET", headers: {} }),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Transport,
			code: TransportErrorCode.RequestFailed,
		});
	});

	it("maps invalid JSON responses to protocol errors", async () => {
		const transport = createBaseTransportForAngular({
			httpClient: {
				request: () =>
					of(
						new HttpResponse({
							status: 200,
							headers: new HttpHeaders({ "content-type": "application/json" }),
							body: "{",
						}),
					),
			},
		});
		await expect(
			transport.execute({ url: "/json", method: "GET", headers: {} }),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: TransportErrorCode.ResponseDecodeFailed,
		});
	});

	it("validates Angular transport options", () => {
		expect(() =>
			createBaseTransportForAngular({
				httpClient: {} as AngularHttpClientLike,
			}),
		).toThrow(/createBaseTransportForAngular could not validate/);
	});
});
