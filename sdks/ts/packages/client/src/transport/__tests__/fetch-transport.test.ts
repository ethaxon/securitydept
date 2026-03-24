import { afterEach, describe, expect, it, vi } from "vitest";
import { createCancellationTokenSource } from "../../cancellation/cancellation-token";
import { ClientError } from "../../errors/client-error";
import { createFetchTransport } from "../fetch-transport";

describe("createFetchTransport()", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("aborts fetch requests when the cancellation token is cancelled", async () => {
		const cancellation = createCancellationTokenSource();
		const transport = createFetchTransport();
		const fetchSpy = vi.fn((_input: string, init?: RequestInit) => {
			const signal = init?.signal;
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					reject(createAbortError());
				});
			});
		});
		vi.stubGlobal("fetch", fetchSpy);

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
			code: "test.fetch_cancelled",
		});
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});

function createAbortError(): Error {
	const error = new Error("Aborted");
	error.name = "AbortError";
	return error;
}
