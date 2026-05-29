import { createReplaySignal, createSignal } from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { toNgSignal } from "../interop";

describe("client-angular interop", () => {
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

	it("converts replay signals with an explicit initial value", () => {
		const source = createReplaySignal<string>();
		const signal = toNgSignal(source, {
			initialValue: null,
			manualCleanup: true,
		});

		expect(signal()).toBeNull();

		source.setValue("ready");

		expect(signal()).toBe("ready");
	});
});
