import { UriReferenceString } from "@securitydept/client";
import { type AnyRouter } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import {
	createRouterForTanStackRouter,
	type TanStackRouterNavigationLike,
} from "../tanstack-router/router";

const acceptTanStackRouter = (_router: TanStackRouterNavigationLike) =>
	undefined;
const assertTanStackRouterCompatibility = (router: AnyRouter) =>
	acceptTanStackRouter(router);
void assertTanStackRouterCompatibility;

describe("TanStack Router adapter", () => {
	it("maps internal push and replace navigation to to", async () => {
		const navigate = vi.fn(async () => undefined);
		const router = createRouterForTanStackRouter({
			router: {
				state: { location: { href: "/current" } },
				navigate,
			},
		});

		await router.navigate({
			url: UriReferenceString.parse("/next"),
			intent: "post_auth_redirect",
			mode: "push",
			state: { from: "current" },
		});
		await router.navigate({
			url: UriReferenceString.parse("/replacement"),
			intent: "post_auth_redirect",
			mode: "replace",
		});

		expect(navigate).toHaveBeenNthCalledWith(1, {
			to: "/next",
			replace: false,
			state: { from: "current" },
		});
		expect(navigate).toHaveBeenNthCalledWith(2, {
			to: "/replacement",
			replace: true,
			state: undefined,
		});
	});

	it("maps external navigation to href", async () => {
		const navigate = vi.fn(async () => undefined);
		const router = createRouterForTanStackRouter({
			router: { navigate },
		});

		await router.navigate({
			url: UriReferenceString.parse(
				"https://idp.example.com/authorize?client_id=web",
			),
			intent: "auth_redirect",
			mode: "external",
			state: { ignored: true },
		});

		expect(navigate).toHaveBeenCalledWith({
			href: "https://idp.example.com/authorize?client_id=web",
		});
	});
});
