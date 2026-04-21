// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { fromAbortSignal, fromStorageEvent } from "../input-sources";

describe("web input-source helpers", () => {
	it("subscribes to AbortSignal abort events", () => {
		const controller = new AbortController();
		const callback = vi.fn();

		fromAbortSignal({
			signal: controller.signal,
			callback,
		});
		controller.abort("query-cancelled");

		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith("query-cancelled");
	});

	it("can emit an already-aborted signal immediately", () => {
		const controller = new AbortController();
		const callback = vi.fn();
		controller.abort("already-aborted");

		fromAbortSignal({
			signal: controller.signal,
			callback,
			emitIfAborted: true,
		});

		expect(callback).toHaveBeenCalledOnce();
		expect(callback).toHaveBeenCalledWith("already-aborted");
	});

	it("removes AbortSignal listeners on unsubscribe", () => {
		const controller = new AbortController();
		const callback = vi.fn();

		const subscription = fromAbortSignal({
			signal: controller.signal,
			callback,
		});
		subscription.unsubscribe();
		controller.abort("ignored");

		expect(callback).not.toHaveBeenCalled();
	});

	it("subscribes to storage events", () => {
		const callback = vi.fn();
		let handler: ((event: StorageEvent) => void) | undefined;

		const target = {
			addEventListener: (_type: string, listener: EventListener) => {
				handler = listener as (event: StorageEvent) => void;
			},
			removeEventListener: vi.fn(),
		};

		fromStorageEvent({
			target,
			callback,
		});
		handler?.(
			new StorageEvent("storage", {
				key: "securitydept.auth",
				newValue: "frontend",
			}),
		);

		expect(callback).toHaveBeenCalledOnce();
		expect(callback.mock.calls[0][0]).toMatchObject({
			key: "securitydept.auth",
			newValue: "frontend",
		});
	});

	it("removes storage listeners on unsubscribe", () => {
		const callback = vi.fn();
		const removeEventListener = vi.fn();
		const target = {
			addEventListener: vi.fn(),
			removeEventListener,
		};

		const subscription = fromStorageEvent({
			target,
			callback,
		});
		subscription.unsubscribe();

		expect(removeEventListener).toHaveBeenCalledWith(
			"storage",
			expect.any(Function),
		);
		expect(callback).not.toHaveBeenCalled();
	});
});
