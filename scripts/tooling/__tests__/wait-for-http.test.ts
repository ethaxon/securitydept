import { afterEach, describe, expect, it, vi } from "vitest";
import {
	BackendWaitCancelledError,
	BackendWaitTimeoutError,
	waitForHttpOk,
} from "../wait-for-http.ts";

describe("waitForHttpOk", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("resolves when the first probe succeeds", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			waitForHttpOk({
				url: "http://localhost:7021/api/health",
				intervalMs: 10,
			}),
		).resolves.toBeUndefined();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries until a probe succeeds", async () => {
		let attempts = 0;
		const fetchMock = vi.fn(async () => {
			attempts += 1;
			if (attempts < 3) {
				return new Response(null, { status: 503 });
			}

			return new Response(null, { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			waitForHttpOk({
				url: "http://localhost:7021/api/health",
				intervalMs: 10,
			}),
		).resolves.toBeUndefined();

		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("rejects with BackendWaitTimeoutError when probes never succeed", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			waitForHttpOk({
				url: "http://localhost:7021/api/health",
				timeoutMs: 40,
				intervalMs: 10,
			}),
		).rejects.toBeInstanceOf(BackendWaitTimeoutError);
	});

	it("rejects with BackendWaitCancelledError when aborted during wait", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Promise<Response>(() => {
					// Never resolve so the wait stays active until abort.
				}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const controller = new AbortController();
		const waitPromise = waitForHttpOk({
			url: "http://localhost:7021/api/health",
			intervalMs: 10,
			signal: controller.signal,
		});

		controller.abort();

		await expect(waitPromise).rejects.toBeInstanceOf(BackendWaitCancelledError);
	});

	it("rejects immediately when the signal is already aborted", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);

		const controller = new AbortController();
		controller.abort();

		await expect(
			waitForHttpOk({
				url: "http://localhost:7021/api/health",
				signal: controller.signal,
			}),
		).rejects.toBeInstanceOf(BackendWaitCancelledError);

		expect(fetchMock).not.toHaveBeenCalled();
	});
});
