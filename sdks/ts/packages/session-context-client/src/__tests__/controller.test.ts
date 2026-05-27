import {
	createInMemoryRecordStore,
	type ExternalTransportTrait,
	type HttpRequest,
	type HttpResponse,
} from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { SessionContextClient } from "../client";
import {
	SessionContextController,
	SessionContextControllerStatus,
} from "../controller";

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createQueuedTransport(
	queue: Array<Promise<HttpResponse>>,
): ExternalTransportTrait {
	return {
		async execute(_request: HttpRequest) {
			const next = queue.shift();
			if (!next) {
				throw new Error("Expected queued response");
			}
			return await next;
		},
	};
}

describe("SessionContextController", () => {
	it("starts in idle state without probing the network", () => {
		const runtime = new SessionContextController({
			client: new SessionContextClient({ baseUrl: "https://auth.example.com" }),
			externalTransport: createQueuedTransport([]),
		});

		expect(runtime.state.get()).toEqual({
			status: SessionContextControllerStatus.Idle,
			session: null,
			error: null,
		});
	});

	it("refresh transitions loading to authenticated", async () => {
		const response = createDeferred<HttpResponse>();
		const runtime = new SessionContextController({
			client: new SessionContextClient({ baseUrl: "https://auth.example.com" }),
			externalTransport: createQueuedTransport([response.promise]),
		});
		const observed: string[] = [];
		runtime.state.subscribe(() => observed.push(runtime.state.get().status));

		const pending = runtime.refresh();
		expect(runtime.state.get()).toMatchObject({
			status: SessionContextControllerStatus.Loading,
		});

		response.resolve({
			status: 200,
			headers: {},
			body: { subject: "session-user-1", display_name: "Alice" },
		});

		await expect(pending).resolves.toMatchObject({
			principal: { subject: "session-user-1", displayName: "Alice" },
		});
		expect(runtime.state.get()).toMatchObject({
			status: SessionContextControllerStatus.Authenticated,
			error: null,
		});
		expect(observed).toEqual([
			SessionContextControllerStatus.Loading,
			SessionContextControllerStatus.Authenticated,
		]);
	});

	it("refresh records failures as error state", async () => {
		const failure = new Error("network unavailable");
		const runtime = new SessionContextController({
			client: new SessionContextClient({ baseUrl: "https://auth.example.com" }),
			externalTransport: createQueuedTransport([Promise.reject(failure)]),
		});

		await expect(runtime.refresh()).rejects.toBe(failure);
		expect(runtime.state.get()).toEqual({
			status: SessionContextControllerStatus.Error,
			session: null,
			error: failure,
		});
	});

	it("logout clears pending redirect and enters unauthenticated state", async () => {
		const requests: HttpRequest[] = [];
		const sessionStorage = createInMemoryRecordStore();
		const externalTransport: ExternalTransportTrait = {
			async execute(request) {
				requests.push(request);
				return { status: 200, headers: {}, body: {} };
			},
		};
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			{ sessionStorage },
		);
		const runtime = new SessionContextController({
			client,
			externalTransport,
		});

		await runtime.rememberPostAuthRedirect("/entries");
		await runtime.logout();

		expect(requests).toContainEqual(
			expect.objectContaining({
				method: "POST",
				url: "https://auth.example.com/auth/session/logout",
			}),
		);
		expect(await client.loadPendingLoginRedirect()).toBeNull();
		expect(runtime.state.get()).toEqual({
			status: SessionContextControllerStatus.Unauthenticated,
			session: null,
			error: null,
		});
	});

	it("coalesces concurrent refresh calls", async () => {
		const response = createDeferred<HttpResponse>();
		const runtime = new SessionContextController({
			client: new SessionContextClient({ baseUrl: "https://auth.example.com" }),
			externalTransport: createQueuedTransport([response.promise]),
		});

		const first = runtime.refresh();
		const second = runtime.refresh();

		expect(second).toBe(first);
		response.resolve({
			status: 401,
			headers: {},
			body: null,
		});

		await expect(first).resolves.toBeNull();
		expect(runtime.state.get()).toMatchObject({
			status: SessionContextControllerStatus.Unauthenticated,
		});
	});
});
