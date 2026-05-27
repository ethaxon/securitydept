import { describe, expect, it, vi } from "vitest";
import {
	createAuthorizedTransportFromBase,
	createRemappingAuthorizedTransportFromBase,
} from "../auth-transport";
import { type HttpRequest, type HttpResponse } from "../types";

describe("authorized transport helpers", () => {
	it("injects the current authorization header into base transport requests", async () => {
		const requests: HttpRequest[] = [];
		const transport = createAuthorizedTransportFromBase(
			{
				authorizationHeader: () => "Bearer token",
			},
			{
				baseTransport: {
					async execute(request: HttpRequest): Promise<HttpResponse> {
						requests.push(request);
						return {
							status: 204,
							headers: {},
							body: null,
						};
					},
				},
			},
		);

		await transport.execute({
			url: "/resource",
			method: "GET",
			headers: {},
		});

		expect(requests[0]?.headers.authorization).toBe("Bearer token");
	});

	it("remaps base transport failures through the caller-provided mapper", async () => {
		const cause = new Error("boom");
		const remapped = new Error("remapped");
		const remapError = vi.fn(() => remapped);
		const transport = createRemappingAuthorizedTransportFromBase(
			{
				authorizationHeader: () => "Bearer token",
			},
			{
				baseTransport: {
					async execute(): Promise<HttpResponse> {
						throw cause;
					},
				},
				remapError,
			},
		);

		await expect(
			transport.execute({
				url: "/resource",
				method: "GET",
				headers: {},
			}),
		).rejects.toBe(remapped);
		expect(remapError).toHaveBeenCalledWith(cause);
	});
});
