import { describe, expect, it } from "vitest";
import { ClientError } from "../../errors/client-error";
import { ClientErrorKind } from "../../errors/types";
import { createCancellationTokenSource } from "../cancellation-token";
import { createLinkedCancellationToken } from "../linked-cancellation-token";

describe("cancellation baseline", () => {
	it("treats dispose() as resource release plus cancellation for the owned token", () => {
		const source = createCancellationTokenSource();
		const seenReasons: unknown[] = [];
		source.token.onCancellationRequested((reason) => {
			seenReasons.push(reason);
		});

		source.dispose();

		expect(source.token.isCancellationRequested).toBe(true);
		expect(seenReasons).toHaveLength(1);
		expect(seenReasons[0]).toBeInstanceOf(ClientError);
		expect(seenReasons[0]).toMatchObject({
			kind: ClientErrorKind.Cancelled,
			message: "Disposed",
		});
	});

	it("propagates the first source cancellation through linked cancellation", () => {
		const outer = createCancellationTokenSource();
		const inner = createCancellationTokenSource();
		const linked = createLinkedCancellationToken(outer.token, inner.token);
		const seenReasons: unknown[] = [];

		linked.onCancellationRequested((reason) => {
			seenReasons.push(reason);
		});

		outer.cancel("navigation");
		inner.cancel("late");

		expect(linked.isCancellationRequested).toBe(true);
		expect(linked.reason).toBe("navigation");
		expect(seenReasons).toEqual(["navigation"]);
	});
});
