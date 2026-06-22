// @vitest-environment jsdom

import { ResourceStatus } from "@securitydept/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContextMode } from "@/auth/model";
import { PlaygroundAccessBoundary } from "@/routes/_playground/-access-boundary";

const mocks = vi.hoisted(() => ({
	logout: vi.fn(async () => undefined),
	navigate: vi.fn(async () => undefined),
	useAuthMode: vi.fn(),
}));

vi.mock("@/auth/react", () => ({
	useAuthMode: mocks.useAuthMode,
	useAuthService: () => ({ logout: mocks.logout }),
}));

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
}));

describe("PlaygroundAccessBoundary", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		mocks.logout.mockClear();
		mocks.navigate.mockClear();
		mocks.useAuthMode.mockReset();
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
	});

	function renderBoundary(): void {
		const queryClient = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		root.render(
			<QueryClientProvider client={queryClient}>
				<PlaygroundAccessBoundary
					expectedMode={AuthContextMode.Basic}
					title="Basic Auth playground"
				>
					<div>Playground content</div>
				</PlaygroundAccessBoundary>
			</QueryClientProvider>,
		);
	}

	it("allows entry when no authentication mode is selected", async () => {
		mocks.useAuthMode.mockReturnValue({
			status: ResourceStatus.Resolved,
			value: null,
		});

		await act(async () => renderBoundary());

		expect(container.textContent).toContain("Playground content");
	});

	it("allows entry when the selected mode matches", async () => {
		mocks.useAuthMode.mockReturnValue({
			status: ResourceStatus.Resolved,
			value: AuthContextMode.Basic,
		});

		await act(async () => renderBoundary());

		expect(container.textContent).toContain("Playground content");
	});

	it("logs out the current mode before navigating to login", async () => {
		mocks.useAuthMode.mockReturnValue({
			status: ResourceStatus.Resolved,
			value: AuthContextMode.Session,
		});

		await act(async () => renderBoundary());
		expect(container.textContent).not.toContain("Playground content");

		const button = container.querySelector("button");
		expect(button).not.toBeNull();
		await act(async () => {
			button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(mocks.logout).toHaveBeenCalledOnce();
		expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login" });
	});
});
