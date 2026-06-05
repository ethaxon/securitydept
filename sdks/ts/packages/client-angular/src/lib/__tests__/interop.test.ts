import { rxResource } from "@angular/core/rxjs-interop";
import { createSignal } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { toNgResource, toNgSignal } from "../interop";

describe("client-angular interop", () => {
	it("forwards Angular rxResource without changing its options contract", () => {
		expect(toNgResource).toBe(rxResource);
	});

	it("converts SDK signals to Angular signals", () => {
		const source = createSignal("initial");
		const signal = toNgSignal(source, {
			initialValue: source.get(),
			manualCleanup: true,
		});

		expect(signal()).toBe("initial");

		source.set("next");

		expect(signal()).toBe("next");
	});

	it("supports requireSync for synchronously emitting sources", () => {
		const source = createSignal("initial");
		const signal = toNgSignal(source, {
			requireSync: true,
			manualCleanup: true,
		});

		expect(signal()).toBe("initial");
	});
});
