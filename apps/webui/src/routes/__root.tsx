import { type SecuritydeptTanStackRouterContext } from "@securitydept/client-react/tanstack-router";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

export const Route =
	createRootRouteWithContext<SecuritydeptTanStackRouterContext>()({
		component: RootShell,
	});

function RootShell() {
	return <Outlet />;
}
