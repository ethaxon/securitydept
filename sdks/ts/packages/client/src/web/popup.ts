import { type as defineType } from "arktype";
import { filter, fromEventPattern, map, take, timer } from "rxjs";
import { type EnvironmentValidators } from "../environment/types";
import { ClientError, ClientErrorKind, UserRecovery } from "../errors";
import { type EventSubjectTrait } from "../events";
import { type WithTraitDeps } from "../injection";
import {
	PopupAttachFailureReason,
	type PopupAttachResult,
	PopupClientWindowHandle,
	type PopupClientWindowHandleTrait,
	PopupErrorCode,
	type PopupOpenOptions,
	PopupServerWindowHandle,
	type PopupTrait,
} from "../popup";
import { type JsonRpcMessage } from "../protocol/json-rpc";
import {
	createAsyncSchedulerWithTimestampProvider,
	RxEventStream,
	RxEventSubject,
} from "../rx";
import { type TimeTrait } from "../scheduling/types";
import {
	throwValidationClientError,
	validateTraitInput,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "../validation";

export interface PopupForNativeWebCreateOptions {
	window?: unknown;
}

export interface PopupFeaturesOptions {
	width?: number;
	height?: number;
}

export interface NativeWebPopupWindowLike {
	closed: boolean;
	close(): void;
	postMessage(message: unknown, targetOrigin: string): void;
}

export type NativeWebPopupContextWindowLike = NativeWebWindowLike &
	NativeWebPopupWindowLike;

export interface NativeWebWindowLike {
	open(
		url: string,
		target?: string,
		features?: string,
	): NativeWebPopupWindowLike | null;
	addEventListener(
		type: "message",
		handler: (event: MessageEvent) => void,
	): void;
	removeEventListener(
		type: "message",
		handler: (event: MessageEvent) => void,
	): void;
	location?: {
		href?: string;
		origin?: string;
	};
	screenX?: number;
	screenY?: number;
	innerWidth?: number;
	innerHeight?: number;
	close?(): void;
	opener?: {
		postMessage(message: unknown, targetOrigin: string): void;
	} | null;
}

interface CreatePopupClientWindowHandleForNativeWebOptions
	extends PopupFeaturesOptions,
		PopupOpenOptions {
	url: string;
	time: TimeTrait;
	window: NativeWebWindowLike;
	expectedOrigin?: string;
	pollIntervalMs?: number;
}

const PopupForNativeWebCreateOptionsSchema = defineType({
	window: {
		open: "Function",
		addEventListener: "Function",
		removeEventListener: "Function",
	},
});

const PopupForNativeWebUnavailableProbeSchema = defineType({
	window: "null | undefined",
});

export function createPopupForNativeWeb(
	options: PopupForNativeWebCreateOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "popup">> &
		WithTraitDeps<{ time: TimeTrait }>,
): PopupTrait | null {
	const { validators, time, ...createOptions } = options;
	const global = globalThis as { window?: NativeWebWindowLike };
	const resolvedCreateOptions = {
		window: global.window ?? null,
		...createOptions,
	};
	const unavailableProbeResult = validateWithSchemaSync(
		PopupForNativeWebUnavailableProbeSchema,
		resolvedCreateOptions,
	);
	if (unavailableProbeResult.success) {
		return null;
	}
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: PopupForNativeWebCreateOptionsSchema,
		validator: validators?.popup,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "web.popup.invalid_native_web_popup_options",
				source: "web",
				messagePrefix:
					"createPopupForNativeWeb could not validate popupForNativeWebCreateOptions",
				failure,
			}),
	});
	const nativeWebWindow = resolvedCreateOptions.window as NativeWebWindowLike;
	return {
		open(url, openOptions) {
			return createPopupClientWindowHandleForNativeWeb({
				url,
				time,
				window: nativeWebWindow,
				...openOptions,
			});
		},
		attach() {
			return attachPopupWindowToOpenerForNativeWeb({
				time,
				window: nativeWebWindow,
			});
		},
	};
}

export function computePopupFeatures(
	options: PopupFeaturesOptions = {},
	windowLike: Pick<
		NativeWebWindowLike,
		"screenX" | "screenY" | "innerWidth" | "innerHeight"
	> = globalThis as NativeWebWindowLike,
): string {
	const width = options.width ?? 500;
	const height = options.height ?? 600;
	const left = Math.max(
		0,
		Math.round(
			(windowLike.screenX ?? 0) +
				((windowLike.innerWidth ?? width) - width) / 2,
		),
	);
	const top = Math.max(
		0,
		Math.round(
			(windowLike.screenY ?? 0) +
				((windowLike.innerHeight ?? height) - height) / 2,
		),
	);

	return `width=${width},height=${height},left=${left},top=${top},popup=yes,toolbar=no,menubar=no`;
}

function createPopupClientWindowHandleForNativeWeb(
	options: CreatePopupClientWindowHandleForNativeWebOptions,
): PopupClientWindowHandleTrait {
	const hostWindow = options.window;
	const features = computePopupFeatures(options, hostWindow);
	const target = options.target ?? "_blank";
	const popupWindow = hostWindow.open(options.url, target, features);

	if (!popupWindow || popupWindow.closed) {
		throw new ClientError({
			kind: ClientErrorKind.Authorization,
			code: PopupErrorCode.Blocked,
			message:
				"Popup window was blocked by the browser. Please allow popups for this site.",
			recovery: UserRecovery.Retry,
			source: "popup",
		});
	}

	const resolvedBaseHref = hostWindow.location?.href ?? "http://localhost";
	const expectedOrigin =
		options.expectedOrigin ?? new URL(options.url, resolvedBaseHref).origin;
	const incoming = RxEventStream.fromObservableInput(
		fromEventPattern<MessageEvent>(
			(handler) => {
				hostWindow.addEventListener("message", handler);
			},
			(handler) => {
				hostWindow.removeEventListener("message", handler);
			},
		).pipe(
			filter(
				(event) =>
					event.origin === expectedOrigin && event.source === popupWindow,
			),
			map((event) => event.data),
		),
	);
	const outgoing = createPostMessageSubject((message) => {
		popupWindow.postMessage(message, expectedOrigin);
	});
	const closedStream = RxEventStream.fromObservableInput(
		timer(
			options.pollIntervalMs ?? 500,
			options.pollIntervalMs ?? 500,
			createAsyncSchedulerWithTimestampProvider(options.time),
		).pipe(
			filter(() => popupWindow.closed),
			map(() => true),
			take(1),
		),
	);

	return new PopupClientWindowHandle({
		close() {
			popupWindow.close();
		},
		messaging: {
			incoming,
			outgoing,
		},
		time: options.time,
		closedStream,
	});
}

function attachPopupWindowToOpenerForNativeWeb(options: {
	time: TimeTrait;
	window: NativeWebWindowLike;
}): PopupAttachResult {
	const currentWindow = options.window as NativeWebPopupContextWindowLike;
	const opener = currentWindow.opener;
	if (!opener) {
		return {
			kind: "failure",
			reason: PopupAttachFailureReason.MissingOpener,
			error: new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"Current page is not attached to a popup opener and cannot attach popup messaging.",
				recovery: UserRecovery.RestartFlow,
				source: "popup",
			}),
		};
	}

	const allowedParentOrigin = currentWindow.location?.origin ?? undefined;
	if (!allowedParentOrigin) {
		return {
			kind: "failure",
			reason: PopupAttachFailureReason.MissingOrigin,
			error: new ClientError({
				kind: ClientErrorKind.Configuration,
				message:
					"Current page has no origin information and cannot attach popup messaging.",
				recovery: UserRecovery.RestartFlow,
				source: "popup",
			}),
		};
	}

	const incoming = RxEventStream.fromObservableInput(
		fromEventPattern<MessageEvent>(
			(handler) => {
				currentWindow.addEventListener("message", handler);
			},
			(handler) => {
				currentWindow.removeEventListener("message", handler);
			},
		).pipe(
			filter(
				(event) =>
					event.origin === allowedParentOrigin && event.source === opener,
			),
			map((event) => event.data),
		),
	);
	const outgoing = createPostMessageSubject((message) => {
		opener.postMessage(message, allowedParentOrigin);
	});

	return {
		kind: "success",
		handle: new PopupServerWindowHandle({
			close() {
				currentWindow.close();
			},
			messaging: {
				incoming,
				outgoing,
			},
		}),
	};
}

function createPostMessageSubject(
	send: (message: JsonRpcMessage) => void,
): EventSubjectTrait<JsonRpcMessage> {
	const outgoing = new RxEventSubject<JsonRpcMessage>();
	outgoing.subscribe({
		next(message) {
			send(message);
		},
	});
	return outgoing;
}
