import { describe, expect, it, vi } from "vitest";
import { createInMemoryRecordStore } from "../../persistence";
import {
	ClientEnvironmentService,
	createBrowserPageClientEnvironment,
	createWebClientEnvironment,
	deriveClientEnvironment,
	type PageLocationHistoryCapability,
	type WebClientEnvironment,
} from "../index";

function createTransport() {
	return {
		execute: vi.fn(async () => ({
			status: 200,
			headers: {},
			body: null,
		})),
	};
}

function createScheduler() {
	return {
		setTimeout() {
			return { cancel() {} };
		},
	};
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {
		promise,
		resolve,
		reject,
	};
}

function createPageCapability(): PageLocationHistoryCapability {
	return {
		location: {
			href: "https://app.example.com/playground/token-set/frontend-mode",
			hash: "",
			pathname: "/playground/token-set/frontend-mode",
			search: "",
		},
		history: {
			replaceState() {},
		},
	};
}

function createEnvironment(): WebClientEnvironment {
	return createWebClientEnvironment({
		transport: createTransport(),
		scheduler: createScheduler(),
		clock: { now: () => Date.now() },
		sessionStore: createInMemoryRecordStore(),
	});
}

function captureThrown(read: () => unknown): unknown {
	try {
		return read();
	} catch (error) {
		return error;
	}
}

describe("ClientEnvironmentService", () => {
	it("coalesces concurrent page resolution and reuses the web layer runtime view", async () => {
		const deferred = createDeferred<WebClientEnvironment>();
		const createClientEnvironment = vi.fn(() => deferred.promise);
		const createPageEnvironment = vi.fn(
			(webEnvironment: WebClientEnvironment) =>
				createBrowserPageClientEnvironment({
					pageCapability: createPageCapability(),
					...deriveClientEnvironment(webEnvironment),
				}),
		);
		const service = new ClientEnvironmentService({
			createClientEnvironment,
			createPageEnvironment,
		});

		const firstPending = service.resolvePageEnvironment();
		const secondPending = service.resolvePageEnvironment();

		expect(firstPending).toBe(secondPending);

		const webEnvironment = createEnvironment();
		deferred.resolve(webEnvironment);

		const pageEnvironment = await firstPending;
		expect(await secondPending).toBe(pageEnvironment);
		expect(createClientEnvironment).toHaveBeenCalledTimes(1);
		expect(createPageEnvironment).toHaveBeenCalledTimes(1);
		expect(pageEnvironment.transport).toBe(webEnvironment.transport);
		expect(pageEnvironment.sessionStore).toBe(webEnvironment.sessionStore);
	});

	it("supports Suspense-style read semantics for pending and fulfilled page environments", async () => {
		const deferred = createDeferred<WebClientEnvironment>();
		const service = new ClientEnvironmentService({
			createClientEnvironment: () => deferred.promise,
			createPageEnvironment: (webEnvironment) =>
				createBrowserPageClientEnvironment({
					pageCapability: createPageCapability(),
					...deriveClientEnvironment(webEnvironment),
				}),
		});

		const pending = captureThrown(() => service.readPageEnvironment());
		expect(pending).toBeInstanceOf(Promise);
		expect(service.resolvePageEnvironment()).toBe(pending);

		const webEnvironment = createEnvironment();
		deferred.resolve(webEnvironment);
		const resolvedPageEnvironment = await (pending as Promise<unknown>);

		expect(service.readPageEnvironment()).toBe(resolvedPageEnvironment);
		expect(service.readPageEnvironment().transport).toBe(
			webEnvironment.transport,
		);
	});

	it("caches rejection until reset and retries with a fresh materialization after reset", async () => {
		const rejectedError = new Error("environment materialization failed");
		const recoveredEnvironment = createEnvironment();
		let attempts = 0;
		const service = new ClientEnvironmentService({
			createClientEnvironment: vi.fn(async () => {
				attempts += 1;
				if (attempts === 1) {
					throw rejectedError;
				}

				return recoveredEnvironment;
			}),
		});

		await expect(service.resolveClientEnvironment()).rejects.toBe(
			rejectedError,
		);
		expect(captureThrown(() => service.readClientEnvironment())).toBe(
			rejectedError,
		);
		await expect(service.resolveClientEnvironment()).rejects.toBe(
			rejectedError,
		);

		service.reset();

		expect(await service.resolveClientEnvironment()).toBe(recoveredEnvironment);
		expect(attempts).toBe(2);
	});

	it("drops stale in-flight page resolutions after reset without repopulating the cache", async () => {
		const staleEnvironment = createEnvironment();
		const freshEnvironment = createEnvironment();
		const deferred = createDeferred<WebClientEnvironment>();
		const createClientEnvironment = vi
			.fn<() => Promise<WebClientEnvironment>>()
			.mockImplementationOnce(() => deferred.promise)
			.mockResolvedValueOnce(freshEnvironment);
		const createPageEnvironment = vi.fn(
			(webEnvironment: WebClientEnvironment) =>
				createBrowserPageClientEnvironment({
					pageCapability: createPageCapability(),
					...deriveClientEnvironment(webEnvironment),
				}),
		);
		const service = new ClientEnvironmentService({
			createClientEnvironment,
			createPageEnvironment,
		});

		const stalePending = service.resolvePageEnvironment();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(createClientEnvironment).toHaveBeenCalledTimes(1);

		service.reset();
		deferred.resolve(staleEnvironment);

		const stalePageEnvironment = await stalePending;
		expect(stalePageEnvironment.transport).toBe(staleEnvironment.transport);

		const freshPageEnvironment = await service.resolvePageEnvironment();

		expect(createClientEnvironment).toHaveBeenCalledTimes(2);
		expect(createPageEnvironment).toHaveBeenCalledTimes(2);
		expect(freshPageEnvironment).not.toBe(stalePageEnvironment);
		expect(freshPageEnvironment.transport).toBe(freshEnvironment.transport);
		expect(await service.resolveClientEnvironment()).toBe(freshEnvironment);
		expect(await service.resolveWebEnvironment()).toBe(freshEnvironment);
		expect(service.readPageEnvironment()).toBe(freshPageEnvironment);
		expect(service.readPageEnvironment()).not.toBe(stalePageEnvironment);
	});

	it("keeps distinct service instances isolated", async () => {
		const first = new ClientEnvironmentService({
			createPageEnvironment: (webEnvironment) =>
				createBrowserPageClientEnvironment({
					pageCapability: createPageCapability(),
					...deriveClientEnvironment(webEnvironment),
				}),
		});
		const second = new ClientEnvironmentService({
			createPageEnvironment: (webEnvironment) =>
				createBrowserPageClientEnvironment({
					pageCapability: createPageCapability(),
					...deriveClientEnvironment(webEnvironment),
				}),
		});

		expect(await first.resolveClientEnvironment()).not.toBe(
			await second.resolveClientEnvironment(),
		);
		expect(await first.resolvePageEnvironment()).not.toBe(
			await second.resolvePageEnvironment(),
		);
	});
});
