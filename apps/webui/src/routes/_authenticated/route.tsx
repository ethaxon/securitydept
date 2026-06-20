import { type AuthRequirement } from "@securitydept/client";
import { secureRouteRoot } from "@securitydept/client-react/tanstack-router";
import { createFileRoute, Outlet } from "@tanstack/react-router";

interface DashboardAuthRequirement extends AuthRequirement {
	readonly kind: "dashboard";
}

const security = secureRouteRoot<DashboardAuthRequirement>({
	requirements: [{ id: "dashboard", kind: "dashboard" }],
});

export const Route = createFileRoute("/_authenticated")({
	component: Outlet,
	staticData: security.staticData,
	beforeLoad(context): Promise<void> {
		return security.beforeLoad(context);
	},
});
