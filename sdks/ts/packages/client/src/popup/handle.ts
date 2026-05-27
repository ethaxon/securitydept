import { type DisposableTrait, SYMBOL_DISPOSE } from "../compat";
import { type ClientError } from "../errors";
import {
	type EventStreamTrait,
	type EventSubjectTrait,
	type EventSubscriptionTrait,
} from "../events";
import {
	createJsonRpcClient,
	createJsonRpcServer,
	type JsonRpcClientTrait,
	type JsonRpcMessage,
	type JsonRpcNotificationEvent,
	type JsonRpcRequestEvent,
	type JsonRpcRequestOptions,
	type JsonRpcServerTrait,
} from "../protocol/json-rpc";
import { type TimeTrait } from "../scheduling/types";
import { type ReadableSignalTrait } from "../signals";
import { PopupClientSession, PopupServerSession } from "./session";

export interface PopupMessageChannelTrait<
	TOutgoing = unknown,
	TIncoming = unknown,
> {
	outgoing: EventSubjectTrait<TOutgoing>;
	incoming: EventStreamTrait<TIncoming>;
}

export interface PopupWindowHandleTrait extends DisposableTrait {
	messaging: PopupMessageChannelTrait;
	readonly onNotification: EventStreamTrait<JsonRpcNotificationEvent>;
	close(): void;
	dispose(): void;
	notify(method: string, params?: unknown): Promise<void>;
}

export interface PopupClientWindowHandleTrait extends PopupWindowHandleTrait {
	readonly failure: ReadableSignalTrait<ClientError | null>;
	readonly isActive: ReadableSignalTrait<boolean>;
	request<TResult = unknown>(
		method: string,
		params?: unknown,
		options?: JsonRpcRequestOptions,
	): Promise<TResult>;
}

export interface PopupServerWindowHandleTrait extends PopupWindowHandleTrait {}

export interface PopupClientWindowHandleOptions {
	close(): void;
	messaging: PopupMessageChannelTrait<JsonRpcMessage, unknown>;
	time: TimeTrait;
	closedStream: EventStreamTrait<boolean>;
}

export interface PopupServerWindowHandleOptions {
	close(): void;
	messaging: PopupMessageChannelTrait<JsonRpcMessage, unknown>;
}

/**
 * popup opener
 */
export class PopupClientWindowHandle implements PopupClientWindowHandleTrait {
	readonly messaging: PopupMessageChannelTrait<JsonRpcMessage, unknown>;
	private disposed = false;
	private readonly jsonRpc: JsonRpcClientTrait;
	private readonly session: PopupClientSession;
	private readonly incomingSubscription: EventSubscriptionTrait;
	private readonly closePopup: () => void;

	constructor(options: PopupClientWindowHandleOptions) {
		this.messaging = options.messaging;
		this.closePopup = options.close;
		this.jsonRpc = createJsonRpcClient({
			send: (message) => {
				options.messaging.outgoing.next(message);
			},
			time: options.time,
		});
		this.session = new PopupClientSession({
			jsonRpc: this.jsonRpc,
			time: options.time,
			closedStream: options.closedStream,
		});
		this.incomingSubscription = options.messaging.incoming.subscribe({
			next: (message) => {
				this.jsonRpc.receive(message);
			},
		});
		this.session.init();
	}

	get onNotification(): EventStreamTrait<JsonRpcNotificationEvent> {
		return this.jsonRpc.onNotification;
	}

	get failure(): ReadableSignalTrait<ClientError | null> {
		return this.session.failure;
	}

	get isActive(): ReadableSignalTrait<boolean> {
		return this.session.isActive;
	}

	async notify(method: string, params?: unknown): Promise<void> {
		this.jsonRpc.notify(method, params);
	}

	request<TResult = unknown>(
		method: string,
		params?: unknown,
		options?: JsonRpcRequestOptions,
	): Promise<TResult> {
		return this.jsonRpc.request(method, params, options);
	}

	close(): void {
		this.closePopup();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.session.dispose();
		this.jsonRpc.dispose();
		this.incomingSubscription.unsubscribe();
		this.messaging.outgoing.complete();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

/**
 * popup target
 */
export class PopupServerWindowHandle implements PopupServerWindowHandleTrait {
	readonly messaging: PopupMessageChannelTrait<JsonRpcMessage, unknown>;
	private disposed = false;
	private readonly jsonRpc: JsonRpcServerTrait;
	private readonly session: PopupServerSession;
	private readonly incomingSubscription: EventSubscriptionTrait;
	private readonly closePopup: () => void;

	constructor(options: PopupServerWindowHandleOptions) {
		this.messaging = options.messaging;
		this.closePopup = options.close;
		this.jsonRpc = createJsonRpcServer({
			send: (message) => {
				options.messaging.outgoing.next(message);
			},
		});
		this.session = new PopupServerSession({ jsonRpc: this.jsonRpc });
		this.incomingSubscription = options.messaging.incoming.subscribe({
			next: (message) => {
				this.jsonRpc.receive(message);
			},
		});
		this.session.init();
	}

	get onNotification(): EventStreamTrait<JsonRpcNotificationEvent> {
		return this.jsonRpc.onNotification;
	}

	get onRequest(): EventStreamTrait<JsonRpcRequestEvent> {
		return this.jsonRpc.onRequest;
	}

	notify(method: string, params?: unknown): Promise<void> {
		this.jsonRpc.notify(method, params);
		return Promise.resolve();
	}

	close(): void {
		this.closePopup();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.session.dispose();
		this.jsonRpc.dispose();
		this.incomingSubscription.unsubscribe();
		this.messaging.outgoing.complete();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}
