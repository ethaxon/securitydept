// @vitest-environment jsdom
// Popup shared infrastructure tests
//
// Tests for the popup window management, relay, and error handling.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError, ClientErrorKind } from "../../errors/index";
import {
	computePopupFeatures,
	openPopupWindow,
	PopupErrorCode,
	relayPopupCallback,
	waitForPopupRelay,
} from "../popup";

describe("popup shared infrastructure", () => {
	describe("computePopupFeatures", () => {
		it("returns a centered features string with defaults", () => {
			// Mock window dimensions.
			vi.stubGlobal("screenX", 100);
			vi.stubGlobal("screenY", 100);
			vi.stubGlobal("innerWidth", 1200);
			vi.stubGlobal("innerHeight", 800);

			const features = computePopupFeatures();
			expect(features).toContain("width=500");
			expect(features).toContain("height=600");
			expect(features).toContain("popup=yes");

			vi.unstubAllGlobals();
		});

		it("accepts custom width and height", () => {
			vi.stubGlobal("screenX", 0);
			vi.stubGlobal("screenY", 0);
			vi.stubGlobal("innerWidth", 1000);
			vi.stubGlobal("innerHeight", 800);

			const features = computePopupFeatures({
				width: 800,
				height: 700,
			});
			expect(features).toContain("width=800");
			expect(features).toContain("height=700");

			vi.unstubAllGlobals();
		});
	});

	describe("openPopupWindow", () => {
		it("throws popup.blocked when window.open returns null", () => {
			vi.stubGlobal("open", () => null);
			vi.stubGlobal("screenX", 0);
			vi.stubGlobal("screenY", 0);
			vi.stubGlobal("innerWidth", 1000);
			vi.stubGlobal("innerHeight", 800);

			try {
				openPopupWindow("https://auth.example.com/login");
				expect.fail("Should have thrown");
			} catch (err) {
				expect(err).toBeInstanceOf(ClientError);
				const clientErr = err as ClientError;
				expect(clientErr.code).toBe(PopupErrorCode.Blocked);
				expect(clientErr.kind).toBe(ClientErrorKind.Authorization);
			}

			vi.unstubAllGlobals();
		});

		it("returns the window handle on success", () => {
			const mockWin = { closed: false } as Window;
			vi.stubGlobal("open", () => mockWin);
			vi.stubGlobal("screenX", 0);
			vi.stubGlobal("screenY", 0);
			vi.stubGlobal("innerWidth", 1000);
			vi.stubGlobal("innerHeight", 800);

			const handle = openPopupWindow("https://auth.example.com/login");
			expect(handle.window).toBe(mockWin);

			vi.unstubAllGlobals();
		});
	});

	describe("waitForPopupRelay", () => {
		let removeListenerSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			removeListenerSpy = vi.fn();
			vi.stubGlobal("addEventListener", vi.fn());
			vi.stubGlobal("removeEventListener", removeListenerSpy);
			vi.stubGlobal("location", { origin: "https://app.example.com" });
		});

		afterEach(() => {
			vi.unstubAllGlobals();
			vi.useRealTimers();
		});

		it("resolves with payload when relay message is received", async () => {
			vi.useFakeTimers();

			const mockPopup = { closed: false } as Window;
			let messageHandler: ((event: MessageEvent) => void) | undefined;

			vi.stubGlobal(
				"addEventListener",
				(type: string, handler: EventListener) => {
					if (type === "message")
						messageHandler = handler as unknown as (
							event: MessageEvent,
						) => void;
				},
			);

			const promise = waitForPopupRelay({
				popup: { window: mockPopup },
				expectedOrigin: "https://app.example.com",
				timeoutMs: 10000,
			});

			// Simulate relay message.
			messageHandler?.({
				origin: "https://app.example.com",
				data: {
					type: "securitydept:popup_callback",
					payload: "https://app.example.com/callback?code=abc",
				},
			} as MessageEvent);

			const result = await promise;
			expect(result).toBe("https://app.example.com/callback?code=abc");
		});

		it("rejects with popup.closed_by_user when popup is closed", async () => {
			vi.useFakeTimers();

			const mockPopup = { closed: false } as Window;
			vi.stubGlobal("addEventListener", vi.fn());

			const promise = waitForPopupRelay({
				popup: { window: mockPopup },
				expectedOrigin: "https://app.example.com",
				timeoutMs: 10000,
				pollIntervalMs: 100,
			});

			// Attach catch handler before triggering rejection.
			const errorPromise = promise.catch((err) => err);

			// Simulate popup being closed.
			(mockPopup as unknown as { closed: boolean }).closed = true;
			await vi.advanceTimersByTimeAsync(200);

			const err = await errorPromise;
			expect(err).toBeInstanceOf(ClientError);
			expect((err as ClientError).code).toBe(PopupErrorCode.Closed);
		});

		it("rejects with popup.relay_timeout after timeout expires", async () => {
			vi.useFakeTimers();

			const mockPopup = {
				closed: false,
				close: vi.fn(),
			} as unknown as Window;
			vi.stubGlobal("addEventListener", vi.fn());

			const promise = waitForPopupRelay({
				popup: { window: mockPopup },
				expectedOrigin: "https://app.example.com",
				timeoutMs: 5000,
				pollIntervalMs: 1000,
			});

			// Attach catch handler before triggering rejection.
			const errorPromise = promise.catch((err) => err);

			await vi.advanceTimersByTimeAsync(5100);

			const err = await errorPromise;
			expect(err).toBeInstanceOf(ClientError);
			expect((err as ClientError).code).toBe(PopupErrorCode.Timeout);
		});

		it("rejects with popup.relay_error when relay contains error", async () => {
			vi.useFakeTimers();

			const mockPopup = { closed: false } as Window;
			let messageHandler: ((event: MessageEvent) => void) | undefined;

			vi.stubGlobal(
				"addEventListener",
				(type: string, handler: EventListener) => {
					if (type === "message")
						messageHandler = handler as unknown as (
							event: MessageEvent,
						) => void;
				},
			);

			const promise = waitForPopupRelay({
				popup: { window: mockPopup },
				expectedOrigin: "https://app.example.com",
				timeoutMs: 10000,
			});

			// Attach catch handler before triggering rejection.
			const errorPromise = promise.catch((err) => err);

			messageHandler?.({
				origin: "https://app.example.com",
				data: {
					type: "securitydept:popup_callback",
					payload: "",
					error: "access_denied",
				},
			} as MessageEvent);

			const err = await errorPromise;
			expect(err).toBeInstanceOf(ClientError);
			expect((err as ClientError).code).toBe(PopupErrorCode.RelayError);
		});
	});

	describe("relayPopupCallback", () => {
		it("posts message to opener and closes window after yielding for message delivery", async () => {
			vi.useFakeTimers();
			const postMessageFn = vi.fn();
			const closeFn = vi.fn();
			vi.stubGlobal("opener", { postMessage: postMessageFn });
			vi.stubGlobal("close", closeFn);
			vi.stubGlobal("location", {
				origin: "https://app.example.com",
				href: "https://app.example.com/callback?code=xyz",
			});

			relayPopupCallback({
				payload: "https://app.example.com/callback?code=xyz",
			});

			expect(postMessageFn).toHaveBeenCalledWith(
				{
					type: "securitydept:popup_callback",
					payload: "https://app.example.com/callback?code=xyz",
					error: undefined,
				},
				"https://app.example.com",
			);
			expect(closeFn).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(0);
			expect(closeFn).toHaveBeenCalledOnce();

			vi.unstubAllGlobals();
			vi.useRealTimers();
		});

		it("does nothing when opener is null", () => {
			vi.stubGlobal("opener", null);

			// Should not throw.
			relayPopupCallback({ payload: "test" });

			vi.unstubAllGlobals();
		});
	});
});
