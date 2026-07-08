import { ResourceStatus } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
	createTokenSetClientRegistryForTest,
	TokenSetClientForTest,
} from "../index";

describe("token-set test factories", () => {
	it("creates a concrete BaseOidcModeClient test subclass", async () => {
		const loginWithRedirect = vi.fn(async () => undefined);
		const client = createTokenSetClientForTest({
			authSnapshot: {
				status: ResourceStatus.Resolved,
				value: {
					tokens: { accessToken: "test-at" },
					metadata: {},
				},
			},
			loginWithRedirect,
		});

		expect(client).toBeInstanceOf(TokenSetClientForTest);
		await expect(client.authResource.whenValue()).resolves.toMatchObject({
			tokens: { accessToken: "test-at" },
		});
		await client.loginWithRedirect({ postAuthRedirectUri: "/after-login" });
		expect(loginWithRedirect).toHaveBeenCalledWith({
			postAuthRedirectUri: "/after-login",
		});
	});

	it("creates lazy entries and a real registry", async () => {
		const client = createTokenSetClientForTest();
		const entry = createTokenSetClientRegistryEntryForTest({
			clientKey: "test-client",
			client,
		});
		const registry = createTokenSetClientRegistryForTest({ entries: [entry] });

		expect(registry.clientRecordFor("test-client").get().status).toBe(
			ResourceStatus.Idle,
		);
		await expect(
			registry.clientRecordFor("test-client", { initialize: true }),
		).resolves.toMatchObject({
			status: ResourceStatus.Resolved,
			client,
		});
	});
});
