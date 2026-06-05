import { describe, expect, it } from "vitest";
import { SYMBOL_OBSERVABLE } from "../../compat";
import {
	createJsonRpcClient,
	createJsonRpcServer,
	type JsonRpcMessage,
} from "../../protocol/json-rpc";
import { RxEventStream } from "../../rx";
import { createSignal } from "../../signals";
import { createTimeForTest } from "../../test";
import { PopupErrorCode } from "../errors";
import { PopupClientSession, PopupServerSession } from "../session";

describe("popup session", () => {
	it("marks the client session active after server ready", async () => {
		const pair = createJsonRpcPeerPair();
		const clientSession = new PopupClientSession({
			jsonRpc: pair.client,
			time: pair.time,
			closedStream: pair.closedStream,
		});
		const serverSession = new PopupServerSession({ jsonRpc: pair.server });

		clientSession.init();
		serverSession.init();

		await Promise.resolve();

		expect(clientSession.isActive.get()).toBe(true);
		expect(clientSession.failure.get()).toBeNull();
	});

	it("keeps failure as nullable state after successful pong", async () => {
		const pair = createJsonRpcPeerPair();
		const clientSession = new PopupClientSession({
			jsonRpc: pair.client,
			time: pair.time,
			closedStream: pair.closedStream,
		});
		const serverSession = new PopupServerSession({ jsonRpc: pair.server });

		clientSession.init();
		serverSession.init();
		pair.time.advanceAndFlush(5_000);

		await Promise.resolve();

		expect(clientSession.isActive.get()).toBe(true);
		expect(clientSession.failure.get()).toBeNull();
	});

	it("sets popup.closed_by_user failure when closed signal turns true", async () => {
		const pair = createJsonRpcPeerPair();
		const clientSession = new PopupClientSession({
			jsonRpc: pair.client,
			time: pair.time,
			closedStream: pair.closedStream,
		});

		pair.closed.set(true);

		expect(clientSession.failure.get()).toMatchObject({
			code: PopupErrorCode.Closed,
		});
		expect(clientSession.isActive.get()).toBe(false);
	});
});

function createJsonRpcPeerPair() {
	const time = createTimeForTest();
	const closed = createSignal(false);
	let clientReceive: ((message: JsonRpcMessage) => void) | undefined;
	let serverReceive: ((message: JsonRpcMessage) => void) | undefined;

	const client = createJsonRpcClient({
		time,
		send(message) {
			serverReceive?.(message as JsonRpcMessage);
		},
	});
	const server = createJsonRpcServer({
		send(message) {
			clientReceive?.(message as JsonRpcMessage);
		},
	});

	clientReceive = (message) => client.receive(message);
	serverReceive = (message) => server.receive(message);

	return {
		client,
		server,
		time,
		closed,
		closedStream: RxEventStream.fromObservableInput(
			closed[SYMBOL_OBSERVABLE](),
		),
	};
}
