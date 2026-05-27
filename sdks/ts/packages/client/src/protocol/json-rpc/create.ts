import { SYMBOL_DISPOSE } from "../../compat";
import { createEventSubject, type EventStreamTrait } from "../../events";
import { validateWithSchemaSync } from "../../validation";
import {
	type CreateJsonRpcClientOptions,
	type CreateJsonRpcServerAndClientOptions,
	type CreateJsonRpcServerOptions,
	type JsonRpcClientTrait,
	type JsonRpcErrorPayload,
	type JsonRpcErrorResponseMessage,
	type JsonRpcId,
	type JsonRpcMessage,
	JsonRpcMessageSchema,
	type JsonRpcNotificationEvent,
	type JsonRpcNotificationMessage,
	type JsonRpcRequestEvent,
	type JsonRpcRequestMessage,
	type JsonRpcRequestOptions,
	type JsonRpcServerAndClientTrait,
	type JsonRpcServerTrait,
	type JsonRpcSuccessResponseMessage,
} from "./types";

type JsonRpcResponseMessage =
	| JsonRpcSuccessResponseMessage
	| JsonRpcErrorResponseMessage;

interface PendingRequest {
	method: string;
	reject(reason: unknown): void;
	resolve(value: unknown): void;
	timeoutHandle?: unknown;
}

export function createJsonRpcClient(
	options: CreateJsonRpcClientOptions,
): JsonRpcClientTrait {
	return new JsonRpcClient(options);
}

export function createJsonRpcServer(
	options: CreateJsonRpcServerOptions,
): JsonRpcServerTrait {
	return new JsonRpcServer(options);
}

export function createJsonRpcServerAndClient(
	options: CreateJsonRpcServerAndClientOptions,
): JsonRpcServerAndClientTrait {
	return new JsonRpcServerAndClient(options);
}

class JsonRpcClient implements JsonRpcClientTrait {
	readonly onNotification: EventStreamTrait<JsonRpcNotificationEvent>;

	private readonly notificationSubject =
		createEventSubject<JsonRpcNotificationEvent>();
	private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>();
	private disposed = false;
	private nextRequestId = 1;

	constructor(private readonly options: CreateJsonRpcClientOptions) {
		this.onNotification = this.notificationSubject;
	}

	request<TResult = unknown>(
		method: string,
		params?: unknown,
		requestOptions: JsonRpcRequestOptions = {},
	): Promise<TResult> {
		if (this.disposed) {
			return Promise.reject(createJsonRpcDisposedError("client"));
		}

		const id = this.nextRequestId++;
		const timeoutMs =
			requestOptions.timeoutMs ?? this.options.defaultRequestTimeoutMs;

		return new Promise<TResult>((resolve, reject) => {
			const pendingRequest: PendingRequest = {
				method,
				reject,
				resolve,
			};

			if (timeoutMs !== undefined) {
				pendingRequest.timeoutHandle = this.options.time.setTimeout(() => {
					this.pendingRequests.delete(id);
					reject(new Error(`JSON-RPC request timed out for ${method}.`));
				}, timeoutMs);
			}

			this.pendingRequests.set(id, pendingRequest);

			try {
				this.options.send({
					jsonrpc: "2.0",
					id,
					method,
					params,
				} satisfies JsonRpcRequestMessage);
			} catch (error) {
				this.clearPendingRequest(id);
				reject(error);
			}
		});
	}

	notify(method: string, params?: unknown): void {
		if (this.disposed) {
			return;
		}
		this.options.send({
			jsonrpc: "2.0",
			method,
			params,
		} satisfies JsonRpcNotificationMessage);
	}

	receive(message: unknown): void {
		if (this.disposed) {
			return;
		}

		for (const parsedMessage of parseIncomingMessages(message)) {
			if (isJsonRpcResponseMessage(parsedMessage)) {
				this.resolvePendingRequest(parsedMessage);
				continue;
			}

			if (isJsonRpcNotificationMessage(parsedMessage)) {
				this.notificationSubject.next({
					method: parsedMessage.method,
					params: parsedMessage.params,
				});
			}
		}
	}

	rejectAllPendingRequests(reason: unknown): void {
		for (const [id, pendingRequest] of this.pendingRequests) {
			this.clearPendingRequest(id);
			pendingRequest.reject(reason);
		}
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.rejectAllPendingRequests(new Error("JSON-RPC client disposed."));
		this.notificationSubject.complete();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private resolvePendingRequest(message: JsonRpcResponseMessage): void {
		const pendingRequest = this.pendingRequests.get(message.id);
		if (!pendingRequest) {
			return;
		}

		this.clearPendingRequest(message.id);

		if ("error" in message) {
			pendingRequest.reject(
				new Error(
					`JSON-RPC request failed for ${pendingRequest.method}: ${message.error.message}`,
				),
			);
			return;
		}

		pendingRequest.resolve(message.result);
	}

	private clearPendingRequest(id: JsonRpcId): void {
		const pendingRequest = this.pendingRequests.get(id);
		if (!pendingRequest) {
			return;
		}

		if (pendingRequest.timeoutHandle !== undefined) {
			this.options.time.clearTimeout(pendingRequest.timeoutHandle);
		}

		this.pendingRequests.delete(id);
	}
}

class JsonRpcServer implements JsonRpcServerTrait {
	readonly onRequest: EventStreamTrait<JsonRpcRequestEvent>;
	readonly onNotification: EventStreamTrait<JsonRpcNotificationEvent>;

	private readonly requestSubject = createEventSubject<JsonRpcRequestEvent>();
	private readonly notificationSubject =
		createEventSubject<JsonRpcNotificationEvent>();
	private disposed = false;

	constructor(private readonly options: CreateJsonRpcServerOptions) {
		this.onRequest = this.requestSubject;
		this.onNotification = this.notificationSubject;
	}

	notify(method: string, params?: unknown): void {
		if (this.disposed) {
			return;
		}
		this.options.send({
			jsonrpc: "2.0",
			method,
			params,
		} satisfies JsonRpcNotificationMessage);
	}

	receive(message: unknown): void {
		if (this.disposed) {
			return;
		}

		for (const parsedMessage of parseIncomingMessages(message)) {
			if (isJsonRpcRequestMessage(parsedMessage)) {
				this.requestSubject.next({
					id: parsedMessage.id,
					method: parsedMessage.method,
					params: parsedMessage.params,
				});
				continue;
			}

			if (isJsonRpcNotificationMessage(parsedMessage)) {
				this.notificationSubject.next({
					method: parsedMessage.method,
					params: parsedMessage.params,
				});
			}
		}
	}

	respondSuccess(id: JsonRpcId, result: unknown): void {
		if (this.disposed) {
			return;
		}
		this.options.send({
			jsonrpc: "2.0",
			id,
			result,
		} satisfies JsonRpcSuccessResponseMessage);
	}

	respondError(id: JsonRpcId, error: JsonRpcErrorPayload): void {
		if (this.disposed) {
			return;
		}
		this.options.send({
			jsonrpc: "2.0",
			id,
			error,
		} satisfies JsonRpcErrorResponseMessage);
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.requestSubject.complete();
		this.notificationSubject.complete();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

class JsonRpcServerAndClient implements JsonRpcServerAndClientTrait {
	readonly onNotification: EventStreamTrait<JsonRpcNotificationEvent>;
	readonly onRequest: EventStreamTrait<JsonRpcRequestEvent>;

	private readonly client: JsonRpcClient;
	private readonly server: JsonRpcServer;
	private disposed = false;

	constructor(options: CreateJsonRpcServerAndClientOptions) {
		this.client = new JsonRpcClient(options);
		this.server = new JsonRpcServer(options);
		this.onNotification = this.server.onNotification;
		this.onRequest = this.server.onRequest;
	}

	request<TResult = unknown>(
		method: string,
		params?: unknown,
		options?: JsonRpcRequestOptions,
	): Promise<TResult> {
		return this.client.request<TResult>(method, params, options);
	}

	notify(method: string, params?: unknown): void {
		this.client.notify(method, params);
	}

	receive(message: unknown): void {
		for (const parsedMessage of parseIncomingMessages(message)) {
			if (isJsonRpcResponseMessage(parsedMessage)) {
				this.client.receive(parsedMessage);
				continue;
			}

			this.server.receive(parsedMessage);
		}
	}

	rejectAllPendingRequests(reason: unknown): void {
		this.client.rejectAllPendingRequests(reason);
	}

	respondSuccess(id: JsonRpcId, result: unknown): void {
		this.server.respondSuccess(id, result);
	}

	respondError(id: JsonRpcId, error: JsonRpcErrorPayload): void {
		this.server.respondError(id, error);
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.client.dispose();
		this.server.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

function parseIncomingMessages(message: unknown): JsonRpcMessage[] {
	if (!Array.isArray(message)) {
		return parseJsonRpcMessage(message);
	}

	const parsedMessages: JsonRpcMessage[] = [];
	for (const entry of message) {
		parsedMessages.push(...parseJsonRpcMessage(entry));
	}
	return parsedMessages;
}

function parseJsonRpcMessage(message: unknown): JsonRpcMessage[] {
	const result = validateWithSchemaSync(JsonRpcMessageSchema, message);
	return result.success ? [result.value] : [];
}

function isJsonRpcRequestMessage(
	message: JsonRpcMessage,
): message is JsonRpcRequestMessage {
	return "method" in message && "id" in message;
}

function isJsonRpcResponseMessage(
	message: JsonRpcMessage,
): message is JsonRpcResponseMessage {
	return "id" in message && !("method" in message);
}

function isJsonRpcNotificationMessage(
	message: JsonRpcMessage,
): message is JsonRpcNotificationMessage {
	return "method" in message && !("id" in message);
}

function createJsonRpcDisposedError(role: "client" | "server"): Error {
	return new Error(`JSON-RPC ${role} disposed.`);
}
