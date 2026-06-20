// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ServerApiRouteAuthBoundary,
	ServerApiRouteAvailability,
} from "@/api/serverHealth";

vi.mock("@/components/layout/Layout", () => ({
	Layout: ({
		children,
		authenticated,
	}: {
		children: React.ReactNode;
		authenticated?: boolean;
	}) => (
		<div data-authenticated={authenticated ? "true" : "false"}>{children}</div>
	),
}));

vi.mock("@/dashboard/queries", () => ({
	useEntriesQuery: () => ({ data: [] }),
	useGroupsQuery: () => ({ data: [] }),
}));

vi.mock("@/auth/react", () => ({
	useAuthService: () => ({ transport: {} }),
}));

vi.mock("@/api/serverHealth", async () => {
	const actual =
		await vi.importActual<typeof import("@/api/serverHealth")>(
			"@/api/serverHealth",
		);

	return {
		...actual,
		useServerHealth: () => ({
			data: {
				status: "ok",
				service: "securitydept-server",
				apis: [
					{
						method: "GET",
						path: "/basic/login",
						auth_required: false,
						auth_boundary: ServerApiRouteAuthBoundary.Protocol,
						availability: ServerApiRouteAvailability.Always,
						description: "Basic Auth login challenge endpoint",
					},
					{
						method: "GET",
						path: "/basic/api/groups/{id}",
						auth_required: true,
						auth_boundary: ServerApiRouteAuthBoundary.BasicAuth,
						availability: ServerApiRouteAvailability.Always,
						description:
							"Get a group by id through the Basic Auth protected mirror",
					},
					{
						method: "ANY",
						path: "/api/propagation/{*rest}",
						auth_required: true,
						auth_boundary: ServerApiRouteAuthBoundary.ConditionalPropagation,
						availability: ServerApiRouteAvailability.ConditionalDisabled,
						description:
							"Conditional propagation forwarding route behind the dashboard auth boundary",
					},
				],
			},
			isLoading: false,
			isError: false,
		}),
	};
});

describe("dashboard route catalog rendering", () => {
	beforeEach(() => {
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
	});

	afterEach(() => {
		document.body.innerHTML = "";
		delete (
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT?: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT;
		vi.clearAllMocks();
	});

	it("renders protocol, basic-auth mirror, and conditional propagation semantics from the server catalog", async () => {
		const { Route } = await import("@/routes/_authenticated/index");
		const DashboardRouteContent = Route.options.component;
		if (!DashboardRouteContent) {
			throw new Error("Dashboard route component is not configured");
		}
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(<DashboardRouteContent />);
		});

		expect(container.textContent).toContain("Available APIs");
		expect(container.textContent).toContain("Boundary");
		expect(container.textContent).toContain("Availability");
		expect(container.textContent).toContain("/basic/login");
		expect(container.textContent).toContain("Protocol");
		expect(container.textContent).toContain("/basic/api/groups/{id}");
		expect(container.textContent).toContain("Basic Auth");
		expect(container.textContent).toContain("/api/propagation/{*rest}");
		expect(container.textContent).toContain("Conditional Propagation");
		expect(container.textContent).toContain("Disabled");
		expect(
			container.querySelector('[data-authenticated="true"]'),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
