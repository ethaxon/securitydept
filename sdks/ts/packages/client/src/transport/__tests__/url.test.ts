import { describe, expect, it } from "vitest";

import { isLoopbackHttpUrl } from "../url";

describe("isLoopbackHttpUrl", () => {
	it("accepts loopback http URLs", () => {
		expect(isLoopbackHttpUrl(new URL("http://localhost:3000"))).toBe(true);
		expect(isLoopbackHttpUrl(new URL("http://127.0.0.1:8080"))).toBe(true);
		expect(isLoopbackHttpUrl(new URL("http://[::1]:5173"))).toBe(true);
	});

	it("rejects non-loopback or non-http URLs", () => {
		expect(isLoopbackHttpUrl(new URL("https://localhost:3000"))).toBe(false);
		expect(isLoopbackHttpUrl(new URL("http://example.com"))).toBe(false);
	});
});
