import type { HttpRequest, HttpTransport } from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { createAuthMaterialController } from "../controller";
import { type AuthSnapshot, AuthSourceKind } from "../types";

function makeSnapshot(accessTokenExpiresAt: string): AuthSnapshot {
	return {
		tokens: {
			accessToken: "expired-token",
			idToken: "id-token",
			accessTokenExpiresAt,
		},
		metadata: { source: { kind: AuthSourceKind.OidcAuthorizationCode } },
	};
}

function makeTransport() {
	const execute = vi.fn().mockResolvedValue({
		status: 200,
		headers: {},
		body: { ok: true },
	});
	return {
		transport: { execute } satisfies HttpTransport,
		execute,
	};
}

function makeRequest(): HttpRequest {
	return {
		url: "https://api.example.com/resource",
		method: "GET",
		headers: {},
	};
}

describe("AuthMaterialController freshness-aware bearer projection", () => {
	it("does not expose an Authorization header for expired snapshots", async () => {
		const controller = createAuthMaterialController();
		await controller.applySnapshot(makeSnapshot("2020-01-01T00:00:00.000Z"));

		expect(controller.authorizationHeader).toBeNull();
	});

	it("does not call the base transport when authorization is required and token is expired", async () => {
		const controller = createAuthMaterialController();
		await controller.applySnapshot(makeSnapshot("2020-01-01T00:00:00.000Z"));
		const { transport, execute } = makeTransport();

		await expect(
			controller.createTransport(transport).execute(makeRequest()),
		).rejects.toMatchObject({
			kind: "unauthenticated",
			code: "token_orchestration.authorization.unavailable",
		});
		expect(execute).not.toHaveBeenCalled();
	});

	it("passes through without Authorization when authorization is optional and token is expired", async () => {
		const controller = createAuthMaterialController();
		await controller.applySnapshot(makeSnapshot("2020-01-01T00:00:00.000Z"));
		const { transport, execute } = makeTransport();

		await controller
			.createTransport(transport, { requireAuthorization: false })
			.execute(makeRequest());

		expect(execute).toHaveBeenCalledWith({
			url: "https://api.example.com/resource",
			method: "GET",
			headers: {},
		});
	});

	it("injects Authorization for fresh snapshots", async () => {
		const controller = createAuthMaterialController();
		await controller.applySnapshot(
			makeSnapshot(new Date(Date.now() + 3_600_000).toISOString()),
		);
		const { transport, execute } = makeTransport();

		await controller.createTransport(transport).execute(makeRequest());

		expect(execute).toHaveBeenCalledWith({
			url: "https://api.example.com/resource",
			method: "GET",
			headers: { authorization: "Bearer expired-token" },
		});
	});
});
