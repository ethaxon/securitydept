// TimeTrait focused unit tests.

import { describe, expect, it } from "vitest";
import { parseDurationToMs } from "../index";

describe("parseDurationToMs", () => {
	it("parses supported duration suffixes into milliseconds", () => {
		expect(parseDurationToMs("150ms")).toBe(150);
		expect(parseDurationToMs("2s")).toBe(2000);
		expect(parseDurationToMs("1.5m")).toBe(90_000);
		expect(parseDurationToMs("1h")).toBe(3_600_000);
	});

	it("returns zero for unsupported duration strings", () => {
		expect(parseDurationToMs("10d")).toBe(0);
		expect(parseDurationToMs("never")).toBe(0);
	});
});
