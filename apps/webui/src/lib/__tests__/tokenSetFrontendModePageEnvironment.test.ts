import { describe, expect, it, vi } from "vitest";
import { TokenSetFrontendModeEnvironmentService } from "@/lib/tokenSetFrontendModePageEnvironment";

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

describe("TokenSetFrontendModeEnvironmentService", () => {
	it("resolves stable client, web, and page environments per service instance", async () => {
		stubPageWindow();
		try {
			const service = new TokenSetFrontendModeEnvironmentService();

			const clientEnvironment = await service.resolveClientEnvironment();
			const webEnvironment = await service.resolveWebEnvironment();
			const pageEnvironment = await service.resolvePageEnvironment();

			expect(await service.resolveClientEnvironment()).toBe(clientEnvironment);
			expect(await service.resolveWebEnvironment()).toBe(webEnvironment);
			expect(await service.resolvePageEnvironment()).toBe(pageEnvironment);
			expect(webEnvironment).toBe(clientEnvironment);
			expect(pageEnvironment.transport).toBe(webEnvironment.transport);
			expect(pageEnvironment.sessionStore).toBeDefined();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("keeps SSR-like service instances isolated", async () => {
		stubPageWindow();
		try {
			const first = new TokenSetFrontendModeEnvironmentService();
			const second = new TokenSetFrontendModeEnvironmentService();

			expect(await first.resolveClientEnvironment()).not.toBe(
				await second.resolveClientEnvironment(),
			);
			expect(await first.resolvePageEnvironment()).not.toBe(
				await second.resolvePageEnvironment(),
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("reset explicitly drops materialized environment layers", async () => {
		stubPageWindow();
		try {
			const service = new TokenSetFrontendModeEnvironmentService();
			const originalPageEnvironment = await service.resolvePageEnvironment();

			service.reset();

			expect(await service.resolvePageEnvironment()).not.toBe(
				originalPageEnvironment,
			);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
