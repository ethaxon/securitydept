import {
	type AuthRequirement,
	createSecureBeforeLoad,
	withTanStackRouteRequirements,
} from "@securitydept/client-react/tanstack-router";
import { TokenSetAuthProvider } from "@securitydept/token-set-context-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	redirect,
} from "@tanstack/react-router";

import { lazy, Suspense, useMemo, useSyncExternalStore } from "react";

import {
	clearPostAuthRedirect,
	fetchCurrentSession,
	rememberPostAuthRedirect,
} from "@/api/auth";
import {
	AuthContextMode,
	clearAuthContextMode,
	getAuthContextMode,
	resolveAuthContextMode,
	subscribeAuthContextMode,
} from "@/lib/authContext";
import { useThemePreference } from "@/lib/theme";
import {
	ensureTokenSetClientReady,
	tokenSetClientFactory,
} from "@/lib/tokenSetClient";
import { DashboardPage } from "@/routes/Dashboard";
import { EntriesPage } from "@/routes/Entries";
import { EntryCreatePage } from "@/routes/EntryCreate";
import { EntryEditPage } from "@/routes/EntryEdit";
import { parseEntrySearch } from "@/routes/entrySearch";
import { GroupCreatePage } from "@/routes/GroupCreate";
import { GroupEditPage } from "@/routes/GroupEdit";
import { GroupsPage } from "@/routes/Groups";
import { LoginPage } from "@/routes/Login";

// ---------------------------------------------------------------------------
// Token-set client registry — canonical React consumer path
// ---------------------------------------------------------------------------

export const TOKEN_SET_CLIENT_KEY = "token-set";

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

// ---------------------------------------------------------------------------
// Route security — canonical SDK path
//
// Non-serializable runtime policy (session fetch, redirect intent, security
// evaluation) is wired at the authenticated layout route level via
// createSecureBeforeLoad. Child routes only carry serializable requirement
// metadata via withTanStackRouteRequirements.
// ---------------------------------------------------------------------------

// Mutable session flag for synchronous auth check. Updated by the
// authenticated layout route's beforeLoad before policy evaluation runs.
let dashboardAuthenticated = false;

const securedBeforeLoad = createSecureBeforeLoad({
	// TanStack's redirect() returns a Redirect object that must be thrown;
	// the SDK interface expects (opts) => never, so we wrap with throw.
	redirect: (opts) => {
		throw redirect(opts);
	},
	checkAuthenticated: (req: AuthRequirement) => {
		if (req.kind === "dashboard") return dashboardAuthenticated;
		return false;
	},
	// /login is the stable primary entry for unauthenticated users.
	// Auth-mode memory may influence the chooser's UI, but it must not
	// hijack the unauthenticated landing target.
	defaultOnUnauthenticated: () => "/login",
});

// ---------------------------------------------------------------------------
// Route tree
// ---------------------------------------------------------------------------

const rootRoute = createRootRoute({
	component: RootShell,
});

// --- Public routes ---

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	component: LoginPage,
});

// --- Authenticated layout route ---
// All protected routes are children of this pathless layout route.
// The beforeLoad performs the async session check, manages redirect intent,
// then delegates to the canonical route-security policy for evaluation.

const authenticatedRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "authenticated",
	staticData: withTanStackRouteRequirements([
		{ id: "dashboard", kind: "dashboard" },
	]),
	beforeLoad: async (ctx) => {
		const mode = resolveAuthContextMode();

		if (mode === AuthContextMode.TokenSet) {
			const snapshot = await ensureTokenSetClientReady();
			dashboardAuthenticated = Boolean(snapshot?.tokens.accessToken);
		} else if (mode === AuthContextMode.Session) {
			const session = await fetchCurrentSession();
			dashboardAuthenticated = session !== null;

			if (!session) {
				await rememberPostAuthRedirect(ctx.location.href);
			} else {
				await clearPostAuthRedirect();
			}
		} else if (mode === AuthContextMode.Basic) {
			// Basic auth relies on the browser's cached credentials (from the
			// earlier 401 WWW-Authenticate challenge at /basic/login). Probe a
			// lightweight protected endpoint to verify the credentials are still
			// valid — the browser automatically attaches the Authorization header.
			try {
				const probe = await fetch("/basic/api/entries", {
					method: "GET",
					headers: { Accept: "application/json" },
				});
				dashboardAuthenticated = probe.ok;
			} catch {
				dashboardAuthenticated = false;
			}
		} else {
			dashboardAuthenticated = false;
		}

		securedBeforeLoad(ctx);
	},
	component: Outlet,
});

// --- Protected routes (children of authenticated layout) ---

const dashboardRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/",
	component: DashboardPage,
});

const entriesRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/entries",
	component: EntriesPage,
});

const entriesCreateRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/entries/new",
	validateSearch: parseEntrySearch,
	component: EntryCreatePage,
});

const entriesEditRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/entries/$entryId/edit",
	validateSearch: parseEntrySearch,
	component: EntryEditPage,
});

const groupsRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/groups",
	component: GroupsPage,
});

const groupsCreateRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/groups/new",
	component: GroupCreatePage,
});

const groupsEditRoute = createRoute({
	getParentRoute: () => authenticatedRoute,
	path: "/groups/$groupId/edit",
	component: GroupEditPage,
});

const tokenSetRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/playground/token-set",
	component: TokenSetRoutePage,
});

const routeTree = rootRoute.addChildren([
	loginRoute,
	tokenSetRoute,
	authenticatedRoute.addChildren([
		dashboardRoute,
		entriesRoute,
		entriesCreateRoute,
		entriesEditRoute,
		groupsRoute,
		groupsCreateRoute,
		groupsEditRoute,
	]),
]);

const router = createRouter({ routeTree });

function TokenSetRoutePage() {
	// Read the *raw* stored mode (null = not logged in at all) so we can
	// distinguish "unauthenticated" from "logged in with a different context".
	// useAuthContextMode() defaults to Session when null, which would wrongly
	// block visitors who haven't chosen any context yet.
	const rawMode = useSyncExternalStore(
		subscribeAuthContextMode,
		getAuthContextMode,
		getAuthContextMode,
	);

	// Block only users actively signed in with a non-token-set context.
	// Unauthenticated (rawMode === null) users may visit to use "Start Token Flow".
	if (rawMode !== null && rawMode !== AuthContextMode.TokenSet) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
				<div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="space-y-1">
						<h2 className="text-base font-semibold">Token Set Playground</h2>
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							This playground requires the{" "}
							<span className="font-medium text-zinc-700 dark:text-zinc-300">
								Token Set
							</span>{" "}
							authentication context. You are currently signed in with a
							different context.
						</p>
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							Sign out first, then return to the login page and choose{" "}
							<span className="font-medium text-zinc-700 dark:text-zinc-300">
								Token Set (OIDC)
							</span>
							.
						</p>
					</div>
					<button
						type="button"
						onClick={() => {
							clearAuthContextMode();
							window.location.href = "/login";
						}}
						className="w-full rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
					>
						Sign out and go to login
					</button>
				</div>
			</div>
		);
	}

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

// ---------------------------------------------------------------------------
// Root shell — global theme initialisation.
// All pages render their own Header (which includes ThemeToggle).
// ---------------------------------------------------------------------------

function RootShell() {
	// Mount the theme hook here so it initialises/applies the stored theme
	// before any child page renders.
	useThemePreference();

	return <Outlet />;
}

export function App() {
	const tokenSetClients = useMemo(
		() => [
			{
				key: TOKEN_SET_CLIENT_KEY,
				clientFactory: tokenSetClientFactory,
				callbackPath: "/playground/token-set",
			},
		],
		[],
	);

	return (
		<QueryClientProvider client={queryClient}>
			<TokenSetAuthProvider clients={tokenSetClients}>
				<RouterProvider router={router} />
			</TokenSetAuthProvider>
		</QueryClientProvider>
	);
}
