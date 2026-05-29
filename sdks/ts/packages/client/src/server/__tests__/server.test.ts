import { describe, expect, it, vi } from "vitest";
import { createEnvironmentForServer } from "../environment";
import { createTransportForServer } from "../transport";

describe("createTransportForServer", () => {
	it("forwards server request headers and lets outgoing request headers override them", async () => {
		const transport = {
			execute: vi.fn(async (request) => ({
				status: 200,
				headers: {},
				body: request.headers,
			})),
		};
		const serverTransport = createTransportForServer({
			transport,
			request: {
				headers: {
					cookie: "session=abc",
					"x-forwarded-host": "app.example.com",
				},
			},
		});

		const response = await serverTransport.execute({
			url: "https://auth.example.com/auth/session/user-info",
			method: "GET",
			headers: {
				cookie: "session=override",
			},
		});

		expect(response.body).toEqual({
			cookie: "session=override",
			"x-forwarded-host": "app.example.com",
		});
	});
});

describe("createEnvironmentForServer", () => {
	it("creates a FoundationEnvironment with request-scoped forwarding transport", async () => {
		const transport = {
			execute: vi.fn(async (request) => ({
				status: 200,
				headers: {},
				body: request.headers,
			})),
		};
		const environment = createEnvironmentForServer({
			transport,
			request: {
				headers: { cookie: "session=abc" },
			},
		});

		const response = await environment.transport.execute({
			url: "https://auth.example.com/auth/session/user-info",
			method: "GET",
			headers: {},
		});

		expect(response.body).toEqual({ cookie: "session=abc" });
	});
});
