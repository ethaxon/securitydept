// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	describeApiRouteAuthBoundary,
	describeApiRouteAvailability,
	fetchServerHealth,
	ServerApiRouteAuthBoundary,
	ServerApiRouteAvailability,
} from "../serverHealth";

describe("server health API consumer", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("preserves auth_boundary and availability from the server catalog", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							status: "ok",
							service: "securitydept-server",
							apis: [
								{
									method: "GET",
									path: "/basic/login",
									auth_required: false,
									auth_boundary: "protocol",
									availability: "always",
									description: "Basic Auth login challenge endpoint",
								},
								{
									method: "ANY",
									path: "/api/propagation/{*rest}",
									auth_required: true,
									auth_boundary: "conditional_propagation",
									availability: "conditional_disabled",
									description:
										"Conditional propagation forwarding route behind the dashboard auth boundary",
								},
							],
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
			),
		);

		const health = await fetchServerHealth();
		const basicLoginRoute = health.apis?.[0];
		const propagationRoute = health.apis?.[1];

		expect(basicLoginRoute).toMatchObject({
			auth_boundary: ServerApiRouteAuthBoundary.Protocol,
			availability: ServerApiRouteAvailability.Always,
		});
		expect(propagationRoute).toMatchObject({
			auth_boundary: ServerApiRouteAuthBoundary.ConditionalPropagation,
			availability: ServerApiRouteAvailability.ConditionalDisabled,
		});
		expect(describeApiRouteAuthBoundary(basicLoginRoute!)).toBe("Protocol");
		expect(describeApiRouteAvailability(propagationRoute!)).toBe("Disabled");
	});
});
