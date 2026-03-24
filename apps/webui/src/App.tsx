import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { requireAuthenticatedRoute } from "@/api/auth";
import { DashboardPage } from "@/routes/Dashboard";
import { EntriesPage } from "@/routes/Entries";
import { EntryCreatePage } from "@/routes/EntryCreate";
import { EntryEditPage } from "@/routes/EntryEdit";
import { parseEntrySearch } from "@/routes/entrySearch";
import { GroupCreatePage } from "@/routes/GroupCreate";
import { GroupEditPage } from "@/routes/GroupEdit";
import { GroupsPage } from "@/routes/Groups";
import { LoginPage } from "@/routes/Login";

const TokenSetPage = lazy(async () => {
	const module = await import("@/routes/TokenSet");
	return { default: module.TokenSetPage };
});

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: false,
			staleTime: 30_000,
		},
	},
});

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
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	component: DashboardPage,
});

const entriesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/entries",
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	component: EntriesPage,
});

const entriesCreateRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/entries/new",
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	validateSearch: parseEntrySearch,
	component: EntryCreatePage,
});

const entriesEditRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/entries/$entryId/edit",
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	validateSearch: parseEntrySearch,
	component: EntryEditPage,
});

const groupsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/groups",
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	component: GroupsPage,
});

const groupsCreateRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/groups/new",
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	component: GroupCreatePage,
});

const groupsEditRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/groups/$groupId/edit",
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	component: GroupEditPage,
});

const tokenSetRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/token-set",
	beforeLoad: ({ location }) => requireAuthenticatedRoute(location.href),
	component: TokenSetRoutePage,
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
	tokenSetRoute,
]);

const router = createRouter({ routeTree });

function TokenSetRoutePage() {
	return (
		<Suspense
			fallback={
				<div className="mx-auto max-w-6xl p-6 text-sm text-zinc-500 dark:text-zinc-400">
					Loading token-set reference page...
				</div>
			}
		>
			<TokenSetPage />
		</Suspense>
	);
}

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}
