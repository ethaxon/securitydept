import { describe, expect, it } from "vitest";
import { ClientError, ClientErrorKind } from "../../errors";
import { PopupErrorCode, type PopupTrait } from "../../popup";
import { createTimeForTest } from "../../test";
import {
	computePopupFeatures,
	createPopupForNativeWeb,
	type NativeWebPopupWindowLike,
	type NativeWebWindowLike,
} from "../popup";

type MessageHandler = (event: MessageEvent) => void;

describe("native web popup adapter", () => {
	it("returns null when native web popup host is unavailable", () => {
		expect(
			createPopupForNativeWeb({
				time: createTimeForTest(),
				window: null,
			}),
		).toBeNull();
	});

	it("validates only the resolved input instead of re-reading globalThis.open", () => {
		try {
			createPopupForNativeWeb({
				time: createTimeForTest(),
				window: {},
			} as never);
			expect.fail("Expected popup validation to fail");
		} catch (error) {
			expect(error).toBeInstanceOf(ClientError);
			expect((error as ClientError).kind).toBe(ClientErrorKind.Configuration);
			expect((error as ClientError).message).toMatch(
				/^createPopupForNativeWeb could not validate popupForNativeWebCreateOptions/,
			);
		}
	});

	it("returns a centered features string with defaults", () => {
		const features = computePopupFeatures(
			{},
			{
				screenX: 100,
				screenY: 100,
				innerWidth: 1200,
				innerHeight: 800,
			},
		);
		expect(features).toContain("width=500");
		expect(features).toContain("height=600");
		expect(features).toContain("popup=yes");
	});

	it("throws popup.blocked when window.open returns null", () => {
		const popup = requirePopup(
			createPopupForNativeWeb({
				time: createTimeForTest(),
				window: {
					open: () => null,
					addEventListener() {},
					removeEventListener() {},
					screenX: 0,
					screenY: 0,
					innerWidth: 1000,
					innerHeight: 800,
					location: {
						href: "https://app.example.com",
						origin: "https://app.example.com",
					},
				},
			}),
		);

		try {
			popup.open("https://auth.example.com/login");
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(ClientError);
			expect((error as ClientError).code).toBe(PopupErrorCode.Blocked);
			expect((error as ClientError).kind).toBe(ClientErrorKind.Authorization);
		}
	});

	it("opens a popup handle with messaging and session", () => {
		const time = createTimeForTest();
		const pair = createNativeWebWindowPair();
		const popup = requirePopup(
			createPopupForNativeWeb({
				time,
				window: pair.parentWindow,
			}),
		);
		const handle = popup.open("https://app.example.com/popup-callback");

		expect(typeof handle.close).toBe("function");
		expect(typeof handle.messaging.outgoing.next).toBe("function");
		expect(typeof handle.notify).toBe("function");
		expect(handle.isActive.get()).toBe(false);
		expect(handle.failure.get()).toBeNull();
	});

	it("attach returns failure when opener is missing", () => {
		const popup = requirePopup(
			createPopupForNativeWeb({
				time: createTimeForTest(),
				window: {
					open() {
						return null;
					},
					addEventListener() {},
					removeEventListener() {},
					location: {
						origin: "https://app.example.com",
					},
					opener: null,
				},
			}),
		);

		const result = popup.attach();
		expect(result.kind).toBe("failure");
		if (result.kind === "failure") {
			expect(result.reason).toBe("missing_opener");
			expect(result.error).toBeInstanceOf(ClientError);
		}
	});

	it("attach returns a popup server session when opener is present", async () => {
		const pair = createNativeWebWindowPair();
		const time = createTimeForTest();
		const clientPopup = requirePopup(
			createPopupForNativeWeb({
				time,
				window: pair.parentWindow,
			}),
		);
		const clientHandle = clientPopup.open(
			"https://app.example.com/popup-callback",
		);
		const popup = requirePopup(
			createPopupForNativeWeb({
				time,
				window: pair.popupWindow,
			}),
		);

		const result = popup.attach();
		expect(result.kind).toBe("success");
		if (result.kind !== "success") {
			return;
		}

		expect(typeof result.handle.notify).toBe("function");

		const requests: unknown[] = [];
		result.handle.onNotification.subscribe({
			next(event) {
				requests.push(event);
			},
		});

		await Promise.resolve();
		await clientHandle.notify("app.test", { ok: true });

		expect(requests).toEqual([
			expect.objectContaining({
				method: "app.test",
				params: { ok: true },
			}),
		]);
	});
});

function requirePopup(popup: PopupTrait | null): PopupTrait {
	expect(popup).not.toBeNull();
	return popup as PopupTrait;
}

function createNativeWebWindowPair(): {
	parentWindow: NativeWebWindowLike;
	popupWindow: NativeWebWindowLike & NativeWebPopupWindowLike;
} {
	const parentListeners = new Set<MessageHandler>();
	const popupListeners = new Set<MessageHandler>();
	const openerProxy = {
		postMessage(message: unknown, targetOrigin: string) {
			for (const listener of parentListeners) {
				listener({
					data: message,
					origin: targetOrigin,
					source: popupWindow,
				} as MessageEvent);
			}
		},
	};

	const popupWindow: NativeWebWindowLike & NativeWebPopupWindowLike = {
		closed: false,
		close() {
			this.closed = true;
		},
		open() {
			return null;
		},
		postMessage(message: unknown, targetOrigin: string) {
			for (const listener of popupListeners) {
				listener({
					data: message,
					origin: targetOrigin,
					source: openerProxy,
				} as MessageEvent);
			}
		},
		addEventListener(_type, handler) {
			popupListeners.add(handler);
		},
		removeEventListener(_type, handler) {
			popupListeners.delete(handler);
		},
		location: {
			href: "https://app.example.com/popup-callback",
			origin: "https://app.example.com",
		},
		opener: openerProxy,
	};

	const parentWindow: NativeWebWindowLike = {
		open() {
			return popupWindow;
		},
		addEventListener(_type, handler) {
			parentListeners.add(handler);
		},
		removeEventListener(_type, handler) {
			parentListeners.delete(handler);
		},
		location: {
			href: "https://app.example.com/login",
			origin: "https://app.example.com",
		},
		screenX: 100,
		screenY: 50,
		innerWidth: 1280,
		innerHeight: 900,
	};

	return {
		parentWindow,
		popupWindow,
	};
}
