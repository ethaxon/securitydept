// @vitest-environment jsdom

import {
	BasicAuthBoundaryKind,
	type BasicAuthBoundarySnapshot,
} from "@securitydept/basic-auth-context-client";
import {
	createSignal,
	type ResourceSnapshot,
	ResourceStatus,
	resourceFromSnapshots,
} from "@securitydept/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContextMode } from "@/auth/model";

const authenticatedBoundary: BasicAuthBoundarySnapshot = {
	authenticated: true,
	boundaryKind: BasicAuthBoundaryKind.Authenticated,
	challengeHeader: null,
	path: "/basic/api/entries",
	status: 200,
};

const boundarySnapshot = createSignal<
	ResourceSnapshot<BasicAuthBoundarySnapshot | null>
>({
	status: ResourceStatus.Resolved,
	value: authenticatedBoundary,
});
const boundaryResource = resourceFromSnapshots(() => boundarySnapshot.get());
const refresh = vi.fn(async () => {
	boundarySnapshot.set({
		status: ResourceStatus.Resolved,
		value: authenticatedBoundary,
	});
	return authenticatedBoundary;
});
const logout = vi.fn(async () => {
	boundarySnapshot.set({
		status: ResourceStatus.Resolved,
		value: null,
	});
});

vi.mock("@securitydept/basic-auth-context-client-react", () => ({
	useBasicAuthContextClient: () => ({
		boundaryResource,
		logout,
		refresh,
	}),
}));

vi.mock("@/auth/react", () => ({
	useAuthMode: () => ({
		status: ResourceStatus.Resolved,
		value: AuthContextMode.Basic,
	}),
	useAuthService: () => ({ login: vi.fn() }),
}));

vi.mock("@/components/layout/Layout", () => ({
	Layout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/routes/_playground/-access-boundary", () => ({
	PlaygroundAccessBoundary: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
}));

describe("Basic Auth playground", () => {
	beforeEach(() => {
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		boundarySnapshot.set({
			status: ResourceStatus.Resolved,
			value: authenticatedBoundary,
		});
		refresh.mockClear();
		logout.mockClear();
	});

	afterEach(() => {
		document.body.innerHTML = "";
		delete (
			globalThis as typeof globalThis & {
				IS_REACT_ACT_ENVIRONMENT?: boolean;
			}
		).IS_REACT_ACT_ENVIRONMENT;
	});

	it("re-probes after logout and renders the browser's still-authenticated result", async () => {
		const { Route } = await import(
			"@/routes/_playground/playground/basic-auth"
		);
		const RouteComponent = Route.options.component;
		if (!RouteComponent) {
			throw new Error(
				"Basic Auth playground route component is not configured",
			);
		}
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<RouteComponent />
				</QueryClientProvider>,
			);
		});
		await act(async () => {
			await vi.waitFor(() => {
				expect(container.textContent).toContain("Authenticated");
			});
		});

		const logoutButton = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent?.includes("Clear observation"),
		);
		expect(logoutButton).toBeDefined();
		await act(async () => {
			logoutButton?.click();
			await vi.waitFor(() => {
				expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(2);
				expect(container.textContent).toContain("Authenticated");
			});
		});
		expect(logout).toHaveBeenCalledOnce();

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});
});
