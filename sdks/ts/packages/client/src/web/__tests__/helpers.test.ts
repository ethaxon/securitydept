import { describe, expect, it } from "vitest";

import { isLoopbackHttpUrl, transformScriptForBrowser } from "../utils/helpers";

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

describe("transformScriptForBrowser", () => {
	it("rewrites default export forms for browser evaluation", () => {
		expect(
			transformScriptForBrowser(
				"export default async function () { return 1; }",
			),
		).toContain("__exports.default = async function");
		expect(
			transformScriptForBrowser(
				"export default function named() { return 1; }",
			),
		).toContain("__exports.default = function named()");
		expect(transformScriptForBrowser("export default 42;")).toBe(
			"__exports.default = 42;",
		);
	});
});
