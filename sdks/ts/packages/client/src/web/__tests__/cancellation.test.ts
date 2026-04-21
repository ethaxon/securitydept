import { describe, expect, it, vi } from "vitest";
import { createCancellationTokenSource } from "../../cancellation/cancellation-token";
import { ClientErrorKind } from "../../errors/types";
import {
	createAbortSignalBridge,
	createCancellationTokenFromAbortSignal,
} from "../cancellation";

describe("web cancellation bridge", () => {
	it("bridges foundation cancellation into AbortSignal for fetch-facing consumers", () => {
		const source = createCancellationTokenSource();
		const bridge = createAbortSignalBridge(source.token);

		expect(bridge.signal?.aborted).toBe(false);

		source.cancel("user-navigation");

		expect(bridge.signal?.aborted).toBe(true);
		expect(bridge.signal?.reason).toBe("user-navigation");
	});

	it("stops forwarding foundation cancellation after bridge disposal", () => {
		const source = createCancellationTokenSource();
		const bridge = createAbortSignalBridge(source.token);

		bridge.dispose();
		source.cancel("ignored-after-dispose");

		expect(bridge.signal?.aborted).toBe(false);
	});

	it("bridges AbortSignal back into the foundation cancellation contract", () => {
		const controller = new AbortController();
		const token = createCancellationTokenFromAbortSignal(controller.signal);
		const listener = vi.fn();

		token?.onCancellationRequested(listener);
		controller.abort("react-query");

		expect(token?.isCancellationRequested).toBe(true);
		expect(token?.reason).toBe("react-query");
		expect(listener).toHaveBeenCalledWith("react-query");

		try {
			token?.throwIfCancellationRequested();
			expect.unreachable("expected cancellation to throw");
		} catch (error) {
			expect(error).toMatchObject({
				kind: ClientErrorKind.Cancelled,
				code: "client.cancelled",
			});
		}
	});

	it("notifies already-aborted subscriptions immediately when bridging AbortSignal into CancellationTokenTrait", () => {
		const controller = new AbortController();
		controller.abort("already-cancelled");

		const token = createCancellationTokenFromAbortSignal(controller.signal);
		const listener = vi.fn();

		token?.onCancellationRequested(listener);

		expect(token?.isCancellationRequested).toBe(true);
		expect(token?.reason).toBe("already-cancelled");
		expect(listener).toHaveBeenCalledOnce();
		expect(listener).toHaveBeenCalledWith("already-cancelled");
	});
});
