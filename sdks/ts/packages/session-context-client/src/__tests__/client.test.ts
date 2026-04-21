import type {
	HttpRequest,
	HttpResponse,
	HttpTransport,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	createInMemoryRecordStore,
} from "@securitydept/client";
import { describe, expect, it } from "vitest";
import { SessionContextClient } from "../client";
import { SessionContextSource } from "../types";

function createTestTransport(
	handler: (request: HttpRequest) => HttpResponse,
): HttpTransport {
	return {
		async execute(request: HttpRequest) {
			return handler(request);
		},
	};
}

describe("SessionContextClient", () => {
	it("normalizes the Rust session /auth/session/user-info payload into SessionInfo", async () => {
		const rustSessionUserInfoResponse = {
			subject: "session-user-1",
			display_name: "Alice",
			picture: "https://example.com/alice.png",
			issuer: "https://issuer.example.com",
			claims: { role: "admin" },
		};

		const transport = createTestTransport(() => ({
			status: 200,
			headers: {},
			body: rustSessionUserInfoResponse,
		}));

		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		const result = await client.fetchUserInfo(transport);
		expect(result).toEqual({
			principal: {
				subject: rustSessionUserInfoResponse.subject,
				displayName: rustSessionUserInfoResponse.display_name,
				picture: rustSessionUserInfoResponse.picture,
				issuer: rustSessionUserInfoResponse.issuer,
				claims: rustSessionUserInfoResponse.claims,
			},
		});
	});

	it("returns null for 401 (unauthenticated)", async () => {
		const transport = createTestTransport(() => ({
			status: 401,
			headers: {},
		}));

		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		const result = await client.fetchUserInfo(transport);
		expect(result).toBeNull();
	});

	it("returns null for 403 (forbidden)", async () => {
		const transport = createTestTransport(() => ({
			status: 403,
			headers: {},
		}));

		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		const result = await client.fetchUserInfo(transport);
		expect(result).toBeNull();
	});

	it("throws ClientError for 500 (server error)", async () => {
		const transport = createTestTransport(() => ({
			status: 500,
			headers: {},
			body: { message: "Internal Server Error" },
		}));

		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		try {
			await client.fetchUserInfo(transport);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ClientError);
			const ce = err as InstanceType<typeof ClientError>;
			expect(ce.kind).toBe(ClientErrorKind.Server);
			expect(ce.retryable).toBe(true);
		}
	});

	it("rejects the legacy session /auth/session/user-info payload without subject", async () => {
		const transport = createTestTransport(() => ({
			status: 200,
			headers: {},
			body: {
				display_name: "Alice",
				picture: "https://example.com/alice.png",
				claims: { role: "admin" },
			},
		}));

		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		await expect(client.fetchUserInfo(transport)).rejects.toMatchObject({
			name: "ClientError",
			kind: ClientErrorKind.Protocol,
			code: "session.invalid_user_info_payload",
			source: SessionContextSource.SessionContext,
		});
	});

	it("executes logout against the configured endpoint", async () => {
		const requests: HttpRequest[] = [];
		const transport = createTestTransport((request) => {
			requests.push(request);
			return {
				status: 200,
				headers: {},
				body: {},
			};
		});

		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		await client.logout(transport);

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			url: "https://api.example.com/auth/session/logout",
			method: "POST",
		});
	});

	it("forwards cancellation tokens through transport-bound session operations", async () => {
		const requests: HttpRequest[] = [];
		const cancellationToken = {
			isCancellationRequested: false,
			reason: undefined,
			throwIfCancellationRequested() {},
			onCancellationRequested() {
				return { dispose() {} };
			},
		};
		const transport = createTestTransport((request) => {
			requests.push(request);
			return {
				status: request.url.endsWith("/user-info") ? 401 : 200,
				headers: {},
				body: {},
			};
		});

		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		await client.fetchUserInfo(transport, cancellationToken);
		await client.logout(transport, cancellationToken);

		expect(requests).toHaveLength(2);
		expect(requests[0]?.cancellationToken).toBe(cancellationToken);
		expect(requests[1]?.cancellationToken).toBe(cancellationToken);
	});

	it("stores and clears pending login redirect state in sessionStore", async () => {
		const sessionStore = createInMemoryRecordStore();
		const client = new SessionContextClient(
			{
				baseUrl: "https://api.example.com",
			},
			{ sessionStore },
		);

		await client.savePendingLoginRedirect("/entries?tab=all");
		expect(await client.loadPendingLoginRedirect()).toBe("/entries?tab=all");

		await client.clearPendingLoginRedirect();
		expect(await client.loadPendingLoginRedirect()).toBeNull();
	});

	it("consumes pending login redirect state from sessionStore", async () => {
		const sessionStore = createInMemoryRecordStore();
		const client = new SessionContextClient(
			{
				baseUrl: "https://api.example.com",
			},
			{ sessionStore },
		);

		await client.savePendingLoginRedirect("/groups");

		expect(await client.consumePendingLoginRedirect()).toBe("/groups");
		expect(await client.loadPendingLoginRedirect()).toBeNull();
	});

	it("resolves the login URL by consuming pending redirect intent", async () => {
		const sessionStore = createInMemoryRecordStore();
		const client = new SessionContextClient(
			{
				baseUrl: "https://api.example.com",
			},
			{ sessionStore },
		);

		await client.rememberPostAuthRedirect("/entries?tab=all");

		expect(await client.resolveLoginUrl()).toBe(
			"https://api.example.com/auth/session/login?post_auth_redirect_uri=%2Fentries%3Ftab%3Dall",
		);
		expect(await client.loadPendingLoginRedirect()).toBeNull();
		expect(await client.resolveLoginUrl()).toBe(
			"https://api.example.com/auth/session/login",
		);
	});

	it("executes logout and clears pending redirect intent in one canonical convenience", async () => {
		const sessionStore = createInMemoryRecordStore();
		const requests: HttpRequest[] = [];
		const transport = createTestTransport((request) => {
			requests.push(request);
			return {
				status: 200,
				headers: {},
				body: {},
			};
		});
		const client = new SessionContextClient(
			{
				baseUrl: "https://api.example.com",
			},
			{ sessionStore },
		);

		await client.rememberPostAuthRedirect("/entries/new");
		await client.logoutAndClearPendingLoginRedirect(transport);

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			url: "https://api.example.com/auth/session/logout",
			method: "POST",
		});
		expect(await client.loadPendingLoginRedirect()).toBeNull();
	});

	it("uses configured default paths aligned with reference server", () => {
		const client = new SessionContextClient({
			baseUrl: "https://api.example.com",
		});

		expect(client.loginUrl()).toBe(
			"https://api.example.com/auth/session/login",
		);
		expect(client.logoutUrl()).toBe(
			"https://api.example.com/auth/session/logout",
		);
	});
});
