import { type SecuritydeptTanStackRouterContext } from "@securitydept/client-react/tanstack-router";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";

export function createAppRouter(context: SecuritydeptTanStackRouterContext) {
	return createRouter({ routeTree, context });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
	interface Register {
		router: AppRouter;
	}
}
