import { describe, expect, it } from "vitest";
import { ClientErrorKind } from "../../errors/types";
import { createCancellationTokenSource } from "../create";
import { createLinkedCancellationToken } from "../linked";

describe("cancellation baseline", () => {
	it("does not throw before cancellation and throws after cancellation", () => {
		const source = createCancellationTokenSource();

		expect(() => source.token.throwIfCancellationRequested()).not.toThrow();

		source.cancel("stop");

		expect(() => source.token.throwIfCancellationRequested()).toThrow(
			/Operation was cancelled/,
		);
		expect(source.token.cancellationError).toMatchObject({
			kind: ClientErrorKind.Cancelled,
			message: "Operation was cancelled",
		});
	});

	it("propagates the first source cancellation through linked cancellation", () => {
		const outer = createCancellationTokenSource();
		const inner = createCancellationTokenSource();
		const linked = createLinkedCancellationToken(outer.token, inner.token);
		const seenReasons: unknown[] = [];

		linked.onCancellationRequested(({ reason }) => {
			seenReasons.push(reason);
		});

		outer.cancel("navigation");
		inner.cancel("late");

		expect(linked.isCancellationRequested).toBe(true);
		expect(linked.reason).toBe("navigation");
		expect(seenReasons).toEqual(["navigation"]);
	});
});
