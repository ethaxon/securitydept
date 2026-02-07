import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	redirect,
} from "@tanstack/react-router";
import { ApiError, api } from "@/api/client";
import { DashboardPage } from "@/routes/Dashboard";
import { EntriesPage } from "@/routes/Entries";
import { EntryCreatePage } from "@/routes/EntryCreate";
import { EntryEditPage } from "@/routes/EntryEdit";
import { parseEntrySearch } from "@/routes/entrySearch";
import { GroupCreatePage } from "@/routes/GroupCreate";
import { GroupEditPage } from "@/routes/GroupEdit";
import { GroupsPage } from "@/routes/Groups";
import { LoginPage } from "@/routes/Login";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: 30_000,
		},
	},
});

// Check auth status; redirect to /login if unauthenticated
async function requireAuth() {
	try {
		await api.get("/auth/me");
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) {
			throw redirect({ to: "/login" });
		}
		throw e;
	}
}

const rootRoute = createRootRoute({
	component: Outlet,
});

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	component: LoginPage,
});

const dashboardRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	beforeLoad: requireAuth,
	component: DashboardPage,
});

const entriesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/entries",
	beforeLoad: requireAuth,
	component: EntriesPage,
});

const entriesCreateRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/entries/new",
	beforeLoad: requireAuth,
	validateSearch: parseEntrySearch,
	component: EntryCreatePage,
});

const entriesEditRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/entries/$entryId/edit",
	beforeLoad: requireAuth,
	validateSearch: parseEntrySearch,
	component: EntryEditPage,
});

const groupsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/groups",
	beforeLoad: requireAuth,
	component: GroupsPage,
});

const groupsCreateRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/groups/new",
	beforeLoad: requireAuth,
	component: GroupCreatePage,
});

const groupsEditRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/groups/$groupId/edit",
	beforeLoad: requireAuth,
	component: GroupEditPage,
});

const routeTree = rootRoute.addChildren([
	loginRoute,
	dashboardRoute,
	entriesRoute,
	entriesCreateRoute,
	entriesEditRoute,
	groupsRoute,
	groupsCreateRoute,
	groupsEditRoute,
]);

const router = createRouter({ routeTree });

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}
