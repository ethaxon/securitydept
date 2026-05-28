import { describe, expect, it } from "vitest";
import { transformScriptForBrowser } from "../contracts/script-compat";

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
