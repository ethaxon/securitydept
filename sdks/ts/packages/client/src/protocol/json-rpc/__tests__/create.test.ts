import { describe, expect, it } from "vitest";
import { createTimeForTest } from "../../../test";
import { createJsonRpcClient, createJsonRpcServer } from "../create";

describe("json-rpc", () => {
	it("supports request/response roundtrip", async () => {
		const pair = createPeerPair();

		pair.right.onRequest.subscribe({
			next(event) {
				pair.right.respondSuccess(event.id, {
					sum:
						((event.params as { a: number; b: number }).a ?? 0) +
						((event.params as { a: number; b: number }).b ?? 0),
				});
			},
		});

		await expect(
			pair.left.request<{ sum: number }>("sum", { a: 1, b: 2 }),
		).resolves.toEqual({ sum: 3 });
	});

	it("delivers notifications", async () => {
		const pair = createPeerPair();

		const received = new Promise<unknown>((resolve) => {
			pair.right.onNotification.subscribe({
				next(event) {
					if (event.method === "notice") {
						resolve(event.params);
					}
				},
			});
		});

		pair.left.notify("notice", { ok: true });
		await expect(received).resolves.toEqual({ ok: true });
	});

	it("rejects request timeout when the remote peer never responds", async () => {
		const time = createTimeForTest();
		const sent: unknown[] = [];
		const peer = createJsonRpcClient({
			send(message) {
				sent.push(message);
			},
			time,
		});

		const request = peer.request("timeout", undefined, {
			timeoutMs: 100,
		});
		time.advanceAndFlush(101);

		await expect(request).rejects.toThrow(/timed out/);
		expect(sent).toHaveLength(1);
	});

	it("ignores invalid incoming messages", () => {
		const pair = createPeerPair();
		const notifications: unknown[] = [];

		pair.right.onNotification.subscribe({
			next(event) {
				notifications.push(event);
			},
		});

		pair.right.receive({
			not: "json-rpc",
		});

		expect(notifications).toEqual([]);
	});

	it("rejects pending requests explicitly", async () => {
		const time = createTimeForTest();
		const sent: unknown[] = [];
		const peer = createJsonRpcClient({
			send(message) {
				sent.push(message);
			},
			time,
		});

		const request = peer.request("notice");
		const rejection = new Error("forced");

		peer.rejectAllPendingRequests(rejection);

		await expect(request).rejects.toBe(rejection);
		expect(sent).toHaveLength(1);
	});

	it("rejects request after dispose but ignores notify after dispose", async () => {
		const time = createTimeForTest();
		const sent: unknown[] = [];
		const peer = createJsonRpcClient({
			send(message) {
				sent.push(message);
			},
			time,
		});

		peer.dispose();
		peer.notify("notice", { ok: true });

		await expect(peer.request("after-dispose")).rejects.toThrow(/disposed/);
		expect(sent).toEqual([]);
	});
});

function createPeerPair() {
	const time = createTimeForTest();

	const left = createJsonRpcClient({
		send(message) {
			right.receive(message);
		},
		time,
	});
	const right = createJsonRpcServer({
		send(message) {
			left.receive(message);
		},
	});

	return {
		left,
		right,
	};
}
