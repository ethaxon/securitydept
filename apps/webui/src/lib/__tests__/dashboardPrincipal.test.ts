import { describe, expect, it } from "vitest";
import { projectDashboardUser } from "../dashboardPrincipal";

describe("projectDashboardUser", () => {
	it("preserves an authenticated principal for session and token-set contexts", () => {
		expect(
			projectDashboardUser({
				principal: {
					subject: "session-user-1",
					displayName: "Alice",
					picture: "https://example.com/alice.png",
				},
				contextLabel: "Session",
			}),
		).toEqual({
			displayName: "Alice",
			picture: "https://example.com/alice.png",
			contextLabel: "Session",
			showIdentity: undefined,
		});
	});

	it("falls back to subject when a token-set principal has no display name", () => {
		expect(
			projectDashboardUser({
				principal: {
					subject: "oidc-user-2",
					displayName: "",
				},
				contextLabel: "Token Set Frontend Mode",
			}),
		).toEqual({
			displayName: "oidc-user-2",
			picture: undefined,
			contextLabel: "Token Set Frontend Mode",
			showIdentity: undefined,
		});
	});

	it("creates a basic-auth context placeholder without app-local fallback logic", () => {
		expect(
			projectDashboardUser({
				contextLabel: "Basic",
				fallbackDisplayName: "Basic auth context",
				fallbackSubject: "context.basic-auth",
				showIdentity: false,
			}),
		).toEqual({
			displayName: "Basic auth context",
			picture: undefined,
			contextLabel: "Basic",
			showIdentity: false,
		});
	});
});
