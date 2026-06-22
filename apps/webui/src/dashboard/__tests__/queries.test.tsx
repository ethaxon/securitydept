// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dashboardQueryKeys, useLogoutMutation } from "../queries";

const mocks = vi.hoisted(() => ({
	logout: vi.fn<() => Promise<void>>(),
	navigate:
		vi.fn<(options: { to: string; replace: boolean }) => Promise<void>>(),
}));

vi.mock("@/auth/react", () => ({
	useAuthService: () => ({ logout: mocks.logout }),
	useAuthenticatedAuthMode: vi.fn(),
	useAuthenticatedAuthUser: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ navigate: mocks.navigate }),
}));

function LogoutHarness({ children }: { children?: ReactNode }) {
	const logout = useLogoutMutation();
	return (
		<button type="button" onClick={() => logout.mutate()}>
			{children ?? "Logout"}
		</button>
	);
}

describe("dashboard logout mutation", () => {
	beforeEach(() => {
		(
			globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
		).IS_REACT_ACT_ENVIRONMENT = true;
		mocks.logout.mockReset();
		mocks.navigate.mockReset();
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

	it("leaves the authenticated route before clearing authentication state", async () => {
		let finishNavigation: (() => void) | undefined;
		mocks.navigate.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishNavigation = resolve;
				}),
		);
		mocks.logout.mockResolvedValue();
		const queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		const resetQueries = vi.spyOn(queryClient, "resetQueries");
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<QueryClientProvider client={queryClient}>
					<LogoutHarness />
				</QueryClientProvider>,
			);
		});

		await act(async () => {
			container.querySelector("button")?.click();
			await vi.waitFor(() => {
				expect(mocks.navigate).toHaveBeenCalledWith({
					to: "/login",
					replace: true,
				});
			});
		});
		expect(mocks.logout).not.toHaveBeenCalled();

		await act(async () => {
			finishNavigation?.();
			await vi.waitFor(() => {
				expect(mocks.logout).toHaveBeenCalledOnce();
				expect(resetQueries).toHaveBeenCalledWith({
					queryKey: dashboardQueryKeys.root,
				});
			});
		});

		await act(async () => root.unmount());
		queryClient.clear();
		container.remove();
	});
});
