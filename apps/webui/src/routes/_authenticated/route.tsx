import { type AuthRequirement } from "@securitydept/client";
import { secureRouteRoot } from "@securitydept/client-react/tanstack-router";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AUTH_SERVICE } from "@/auth/auth.service";

const SESSION_POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";

interface DashboardAuthRequirement extends AuthRequirement {
	readonly kind: "dashboard";
}

function createLoginPath(postAuthRedirectUri?: string): string {
	if (!postAuthRedirectUri) {
		return "/login";
	}
	const search = new URLSearchParams({
		[SESSION_POST_AUTH_REDIRECT_PARAM]: postAuthRedirectUri,
	});
	return `/login?${search.toString()}`;
}

const security = secureRouteRoot<DashboardAuthRequirement>({
	requirements: [{ id: "dashboard", kind: "dashboard" }],
	behaviour: {
		checkAuthenticated: (requirement, context) => {
			if (requirement.kind !== "dashboard") {
				return false;
			}
			return context.environment.injector
				.get(AUTH_SERVICE)
				.ensureAuthenticatedForRoute(context.planContext.routeState.url);
		},
		onUnauthenticated: (_requirement, context) =>
			createLoginPath(context.planContext.routeState.url),
	},
});

export const Route = createFileRoute("/_authenticated")({
	component: Outlet,
	staticData: security.staticData,
	async beforeLoad(context) {
		await security.beforeLoad?.(context);
	},
});
