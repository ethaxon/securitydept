import { afterEach, describe, expect, it, vi } from "vitest";
import { createCancellationTokenSource } from "../../cancellation/create";
import { ClientError } from "../../errors/client-error";
import { ClientErrorKind } from "../../errors/types";
import { createBaseTransportForStdFetch } from "../../std/transport";
import { TransportErrorCode } from "../types";

describe("createBaseTransportForStdFetch()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("aborts fetch requests when the cancellation token is cancelled", async () => {
		const cancellation = createCancellationTokenSource();
		const fetchSpy = vi.fn((_input: string, init?: RequestInit) => {
			const signal = init?.signal;
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					reject(createAbortError());
				});
			});
		});
		const transport = createBaseTransportForStdFetch({
			fetch: fetchSpy as typeof fetch,
		});

		const requestPromise = transport.execute({
			url: "https://api.example.com/resource",
			method: "GET",
			headers: {},
			cancellationToken: cancellation.token,
		});

		cancellation.cancel(
			new ClientError({
				kind: "cancelled",
				code: "test.fetch_cancelled",
				message: "Cancelled by test",
				source: "transport-test",
			}),
		);

		await expect(requestPromise).rejects.toMatchObject({
			name: "ClientError",
			kind: "cancelled",
			code: "client.cancelled",
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("maps network failures to transport errors", async () => {
		const cause = new TypeError("SECRET_NETWORK_DETAIL");
		const transport = createBaseTransportForStdFetch({
			fetch: vi.fn().mockRejectedValue(cause),
		});
		await expect(
			transport.execute({
				url: "https://api.example.com",
				method: "GET",
				headers: {},
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Transport,
			code: TransportErrorCode.RequestFailed,
			cause,
		});
	});

	it("maps invalid JSON responses to protocol errors", async () => {
		const transport = createBaseTransportForStdFetch({
			fetch: vi.fn().mockResolvedValue(
				new Response("{", {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		});
		await expect(
			transport.execute({
				url: "https://api.example.com",
				method: "GET",
				headers: {},
			}),
		).rejects.toMatchObject({
			kind: ClientErrorKind.Protocol,
			code: TransportErrorCode.ResponseDecodeFailed,
		});
	});
});

function createAbortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}
