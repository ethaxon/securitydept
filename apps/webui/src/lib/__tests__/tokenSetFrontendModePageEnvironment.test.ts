import { describe, expect, it, vi } from "vitest";
import { createTokenSetFrontendModePageEnvironment } from "@/lib/tokenSetFrontendModePageEnvironment";

function stubPageWindow(): void {
	vi.stubGlobal("window", {
		location: {
			href: "https://app.example.com/playground/token-set/frontend-mode",
			hash: "",
			pathname: "/playground/token-set/frontend-mode",
			search: "",
		},
		history: {
			replaceState() {},
		},
	});
}

describe("createTokenSetFrontendModePageEnvironment", () => {
	it("creates a page environment from the host page capability", () => {
		stubPageWindow();
		try {
			const environment = createTokenSetFrontendModePageEnvironment();

			expect(environment.router?.currentUrl()?.toString()).toBe(
				"https://app.example.com/playground/token-set/frontend-mode",
			);
			expect(environment.transport).toBeDefined();
			expect(environment.sessionStorage).toBeDefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("does not cache page environments behind a module singleton", () => {
		stubPageWindow();
		try {
			expect(createTokenSetFrontendModePageEnvironment()).not.toBe(
				createTokenSetFrontendModePageEnvironment(),
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
