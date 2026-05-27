import { type as defineType } from "arktype";
import { type DisposableTrait } from "../../compat";
import { type EventStreamTrait } from "../../events";
import { type TimeTrait } from "../../scheduling/types";

export const JsonRpcIdSchema = defineType("string | number");

export type JsonRpcId = typeof JsonRpcIdSchema.infer;

export const JsonRpcErrorPayloadSchema = defineType({
	code: "number",
	message: "string",
	data: "unknown?",
});

export type JsonRpcErrorPayload = typeof JsonRpcErrorPayloadSchema.infer;

export const JsonRpcRequestMessageSchema = defineType({
	jsonrpc: '"2.0"',
	id: JsonRpcIdSchema,
	method: "string",
	params: "unknown?",
});

export type JsonRpcRequestMessage = typeof JsonRpcRequestMessageSchema.infer;

export const JsonRpcNotificationMessageSchema = defineType({
	jsonrpc: '"2.0"',
	method: "string",
	params: "unknown?",
});

export type JsonRpcNotificationMessage =
	typeof JsonRpcNotificationMessageSchema.infer;

export const JsonRpcSuccessResponseMessageSchema = defineType({
	jsonrpc: '"2.0"',
	id: JsonRpcIdSchema,
	result: "unknown",
});

export type JsonRpcSuccessResponseMessage =
	typeof JsonRpcSuccessResponseMessageSchema.infer;

export const JsonRpcErrorResponseMessageSchema = defineType({
	jsonrpc: '"2.0"',
	id: JsonRpcIdSchema,
	error: JsonRpcErrorPayloadSchema,
});

export type JsonRpcErrorResponseMessage =
	typeof JsonRpcErrorResponseMessageSchema.infer;

export const JsonRpcMessageSchema = JsonRpcRequestMessageSchema.or(
	JsonRpcNotificationMessageSchema,
)
	.or(JsonRpcSuccessResponseMessageSchema)
	.or(JsonRpcErrorResponseMessageSchema);

export type JsonRpcMessage = typeof JsonRpcMessageSchema.infer;

export interface JsonRpcRequestEvent {
	id: JsonRpcId;
	method: string;
	params?: unknown;
}

export interface JsonRpcNotificationEvent {
	method: string;
	params?: unknown;
}

export interface JsonRpcRequestOptions {
	timeoutMs?: number;
}

export interface JsonRpcSendOptions {
	send(message: JsonRpcMessage): void;
}

export interface CreateJsonRpcClientOptions extends JsonRpcSendOptions {
	time: TimeTrait;
	defaultRequestTimeoutMs?: number;
}

export interface CreateJsonRpcServerOptions extends JsonRpcSendOptions {}

export interface CreateJsonRpcServerAndClientOptions
	extends JsonRpcSendOptions {
	time: TimeTrait;
	defaultRequestTimeoutMs?: number;
}

export interface JsonRpcClientTrait extends DisposableTrait {
	readonly onNotification: EventStreamTrait<JsonRpcNotificationEvent>;
	request<TResult = unknown>(
		method: string,
		params?: unknown,
		options?: JsonRpcRequestOptions,
	): Promise<TResult>;
	notify(method: string, params?: unknown): void;
	receive(message: unknown): void;
	rejectAllPendingRequests(reason: unknown): void;
}

export interface JsonRpcServerTrait extends DisposableTrait {
	readonly onRequest: EventStreamTrait<JsonRpcRequestEvent>;
	readonly onNotification: EventStreamTrait<JsonRpcNotificationEvent>;
	notify(method: string, params?: unknown): void;
	receive(message: unknown): void;
	respondSuccess(id: JsonRpcId, result: unknown): void;
	respondError(id: JsonRpcId, error: JsonRpcErrorPayload): void;
}

export interface JsonRpcServerAndClientTrait
	extends JsonRpcClientTrait,
		JsonRpcServerTrait {}
