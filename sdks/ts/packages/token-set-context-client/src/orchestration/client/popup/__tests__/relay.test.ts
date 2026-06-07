import {
	createCancellationTokenSource,
	createEventSubject,
	createSignal,
	type PopupClientWindowHandleTrait,
	type PopupServerWindowHandleTrait,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	relayTokenSetPopupCallback,
	TokenSetPopupRelayErrorCode,
	TokenSetPopupRelayMethod,
	waitForTokenSetPopupRelay,
} from "../relay";

function createBrowserTime() {
	return {
		now: () => Date.now(),
		setTimeout: (callback: () => void, delayMs: number) =>
			globalThis.setTimeout(callback, delayMs),
		clearTimeout: (handle: unknown) =>
			globalThis.clearTimeout(
				handle as ReturnType<typeof globalThis.setTimeout>,
			),
	};
}

function createTestPopup(
	onNotification = createEventSubject<{
		method: string;
		params?: unknown;
	}>(),
): PopupClientWindowHandleTrait {
	return {
		onNotification,
		dispose: vi.fn(),
		close: vi.fn(),
		messaging: {
			incoming: onNotification,
			outgoing: createEventSubject(),
		},
		notify: vi.fn(async () => undefined),
		request: vi.fn(),
		failure: createSignal(null),
		isActive: createSignal(true),
	} as unknown as PopupClientWindowHandleTrait;
}

function createTestServerPopup(): PopupServerWindowHandleTrait {
	return {
		onNotification: createEventSubject(),
		notify: vi.fn(async () => undefined),
		dispose: vi.fn(),
		close: vi.fn(),
		messaging: {
			incoming: createEventSubject(),
			outgoing: createEventSubject(),
		},
	} as unknown as PopupServerWindowHandleTrait;
}

describe("waitForTokenSetPopupRelay", () => {
	it("stops waiting when the operation cancellation token is cancelled", async () => {
		const popup = createTestPopup();
		const cancellation = createCancellationTokenSource();
		const reason = new Error("cancel popup relay");
		const waitPromise = waitForTokenSetPopupRelay({
			popup,
			time: createBrowserTime(),
			cancellationToken: cancellation.token,
		});

		cancellation.cancel(reason);

		await expect(waitPromise).rejects.toMatchObject({
			kind: "cancelled",
			code: "client.cancelled",
			cause: reason,
		});
		expect(popup.dispose).toHaveBeenCalledTimes(1);
		expect(popup.close).toHaveBeenCalledTimes(1);
	});

	it("resolves with callback payload from the relay notification stream", async () => {
		const notifications = createEventSubject<{
			method: string;
			params?: unknown;
		}>();
		const popup = createTestPopup(notifications);
		const waitPromise = waitForTokenSetPopupRelay({
			popup,
			time: createBrowserTime(),
		});

		notifications.next({
			method: TokenSetPopupRelayMethod.Callback,
			params: { payload: "https://app.example.com/callback?code=abc" },
		});

		await expect(waitPromise).resolves.toBe(
			"https://app.example.com/callback?code=abc",
		);
		expect(popup.dispose).toHaveBeenCalledTimes(1);
		expect(popup.close).toHaveBeenCalledTimes(1);
	});

	it("rejects relay payload errors and still closes the popup", async () => {
		const notifications = createEventSubject<{
			method: string;
			params?: unknown;
		}>();
		const popup = createTestPopup(notifications);
		const waitPromise = waitForTokenSetPopupRelay({
			popup,
			time: createBrowserTime(),
		});

		notifications.next({
			method: TokenSetPopupRelayMethod.Callback,
			params: { error: "provider_error" },
		});

		await expect(waitPromise).rejects.toMatchObject({
			code: TokenSetPopupRelayErrorCode.Payload,
		});
		expect(popup.dispose).toHaveBeenCalledTimes(1);
		expect(popup.close).toHaveBeenCalledTimes(1);
	});

	it("rejects when the relay notification does not arrive before timeout", async () => {
		const popup = createTestPopup();

		await expect(
			waitForTokenSetPopupRelay({
				popup,
				time: createBrowserTime(),
				timeoutMs: 20,
			}),
		).rejects.toMatchObject({
			code: TokenSetPopupRelayErrorCode.Timeout,
		});
		expect(popup.dispose).toHaveBeenCalledTimes(1);
		expect(popup.close).toHaveBeenCalledTimes(1);
	});
});

describe("relayTokenSetPopupCallback", () => {
	it("notifies the opener and closes the popup by default", async () => {
		const popup = createTestServerPopup();

		await relayTokenSetPopupCallback({
			popup,
			payload: "https://app.example.com/callback?code=abc",
		});

		expect(popup.notify).toHaveBeenCalledWith(
			TokenSetPopupRelayMethod.Callback,
			{
				payload: "https://app.example.com/callback?code=abc",
				error: undefined,
			},
		);
		expect(popup.close).toHaveBeenCalledTimes(1);
		expect(popup.dispose).toHaveBeenCalledTimes(1);
	});

	it("skips popup cleanup when closeAfterRelay is false", async () => {
		const popup = createTestServerPopup();

		await relayTokenSetPopupCallback({
			popup,
			payload: "https://app.example.com/callback?code=abc",
			closeAfterRelay: false,
		});

		expect(popup.notify).toHaveBeenCalledTimes(1);
		expect(popup.close).not.toHaveBeenCalled();
		expect(popup.dispose).not.toHaveBeenCalled();
	});

	it("still closes the popup when notify fails", async () => {
		const popup = createTestServerPopup();
		vi.mocked(popup.notify).mockRejectedValueOnce(new Error("notify failed"));

		await relayTokenSetPopupCallback({
			popup,
			payload: "https://app.example.com/callback?code=abc",
		});

		expect(popup.close).toHaveBeenCalledTimes(1);
		expect(popup.dispose).toHaveBeenCalledTimes(1);
	});
});
