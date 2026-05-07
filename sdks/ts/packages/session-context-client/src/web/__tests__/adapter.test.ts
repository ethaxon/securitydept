import {
	createInMemoryRecordStore,
	type PageLocationCapability,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { SessionContextClient } from "../../client";
import { loginWithRedirect } from "../index";

function createPageLocationCapability(href: string): PageLocationCapability {
	const url = new URL(href);
	return {
		location: {
			href,
			hash: url.hash,
			pathname: url.pathname,
			search: url.search,
		},
	};
}

describe("session web adapter", () => {
	it("saves a pending redirect and navigates through explicit page capabilities", async () => {
		const sessionStore = createInMemoryRecordStore();
		const environment = createPageLocationCapability(
			"https://app.example.com/current",
		);
		const client = new SessionContextClient(
			{ baseUrl: "https://auth.example.com" },
			{ sessionStore },
		);

		await loginWithRedirect(client, { environment });

		expect(await client.loadPendingLoginRedirect()).toBe(
			"https://app.example.com/current",
		);
		expect(environment.location.href).toBe(
			"https://auth.example.com/auth/session/login?post_auth_redirect_uri=https%3A%2F%2Fapp.example.com%2Fcurrent",
		);
	});

	it("fails without explicit environment instead of reading a global window", async () => {
		const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"window",
		);
		let windowRead = false;

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			get() {
				windowRead = true;
				return {
					location: {
						href: "https://app.example.com/current",
						hash: "",
					},
				};
			},
		});

		try {
			const sessionStore = createInMemoryRecordStore();
			const client = new SessionContextClient(
				{ baseUrl: "https://auth.example.com" },
				{ sessionStore },
			);

			await expect(loginWithRedirect(client)).rejects.toThrow(
				/createBrowserPageClientEnvironment/,
			);
			expect(await client.loadPendingLoginRedirect()).toBeNull();
			expect(windowRead).toBe(false);
		} finally {
			vi.unstubAllGlobals();
			if (originalWindowDescriptor) {
				Object.defineProperty(globalThis, "window", originalWindowDescriptor);
			} else {
				Reflect.deleteProperty(globalThis, "window");
			}
		}
	});
});
