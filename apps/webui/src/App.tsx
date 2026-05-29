import {
	createBasicAuthContextClient,
	provideBasicAuthContextClient,
} from "@securitydept/basic-auth-context-client-react";
import { SecuritydeptInjector } from "@securitydept/client";
import {
	provideEnvironment,
	SecuritydeptProvider,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	type AuthRequirement,
	createSecureBeforeLoad,
	withTanStackRouteRequirements,
} from "@securitydept/client-react/tanstack-router";
import { provideSessionContextClient } from "@securitydept/session-context-client-react";
import { describeFrontendOidcModeCallbackError } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import {
	CallbackResumeStatus,
	provideTokenSetAuthRegistry,
	provideTokenSetCallbackResumeController,
	TOKEN_SET_AUTH_REGISTRY,
	TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
	useTokenSetCallbackResume,
} from "@securitydept/token-set-context-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	redirect,
} from "@tanstack/react-router";

import {
	lazy,
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useSyncExternalStore,
} from "react";

import { ErrorPresentationCallout } from "@/components/common/ErrorPresentationCallout";
import {
	AuthContextMode,
	clearAuthContextMode,
	getAuthContextMode,
	resolveAuthContextMode,
	subscribeAuthContextMode,
} from "@/lib/authContext";
import { basicAuthContextConfig } from "@/lib/basicAuthContext";
import { sessionContextClient } from "@/lib/sessionContext";
import { useThemePreference } from "@/lib/theme";
import {
	ensureTokenSetBackendModeClientReady,
	tokenSetBackendModeClientFactory,
} from "@/lib/tokenSetBackendModeClient";
import {
	TOKEN_SET_BACKEND_MODE_CLIENT_KEY,
	TOKEN_SET_BACKEND_MODE_PLAYGROUND_PATH,
	TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	TOKEN_SET_FRONTEND_MODE_CLIENT_KEY,
	TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
	TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH,
} from "@/lib/tokenSetConfig";
import {
	ensureTokenSetFrontendModeClientReady,
	tokenSetFrontendModeClientFactory,
} from "@/lib/tokenSetFrontendModeClient";
import { createTokenSetFrontendModePageEnvironment } from "@/lib/tokenSetFrontendModePageEnvironment";
import { DashboardPage } from "@/routes/Dashboard";
import { EntriesPage } from "@/routes/Entries";
import { EntryCreatePage } from "@/routes/EntryCreate";
import { EntryEditPage } from "@/routes/EntryEdit";
import { parseEntrySearch } from "@/routes/entrySearch";
import { GroupCreatePage } from "@/routes/GroupCreate";
import { GroupEditPage } from "@/routes/GroupEdit";
import { GroupsPage } from "@/routes/Groups";
import { LoginPage } from "@/routes/Login";
import { TokenSetFrontendModePopupCallbackPage } from "@/routes/TokenSetFrontendModePopupCallback";

// ---------------------------------------------------------------------------
// Token-set client registry — canonical React consumer path
// ---------------------------------------------------------------------------

const TokenSetBackendModePlaygroundPage = lazy(async () => {
	const module = await import("@/routes/TokenSetBackendModePlayground");
	return { default: module.TokenSetBackendModePlaygroundPage };
});

const TokenSetFrontendModePlaygroundPage = lazy(async () => {
	const module = await import("@/routes/TokenSetFrontendModePlayground");
	return { default: module.TokenSetFrontendModePlaygroundPage };
});

const SessionPlaygroundPage = lazy(async () => {
	const module = await import("@/routes/SessionPlayground");
	return { default: module.SessionPlaygroundPage };
});

const BasicAuthPlaygroundPage = lazy(async () => {
	const module = await import("@/routes/BasicAuthPlayground");
	return { default: module.BasicAuthPlaygroundPage };
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
const SESSION_POST_AUTH_REDIRECT_PARAM = "post_auth_redirect_uri";

function createLoginPath(postAuthRedirectUri?: string): string {
	if (!postAuthRedirectUri) {
		return "/login";
	}
	const search = new URLSearchParams({
		[SESSION_POST_AUTH_REDIRECT_PARAM]: postAuthRedirectUri,
	});
	return `/login?${search.toString()}`;
}

const securedBeforeLoad = createSecureBeforeLoad({
	// TanStack's redirect() returns a Redirect object that must be thrown;
	// the SDK interface expects (opts) => never, so we wrap with throw.
	redirect: (opts) => {
		throw redirect(opts);
	},
	checkAuthenticated: (req: AuthRequirement) => {
		if (req.kind === "dashboard") {
			return dashboardAuthenticated;
		}
		return false;
	},
	// /login is the stable primary entry for unauthenticated users.
	// Auth-mode memory may influence the chooser's UI, but it must not
	// hijack the unauthenticated landing target.
	defaultOnUnauthenticated: (_requirement, context) =>
		createLoginPath(context.attemptedUrl),
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
	validateSearch: (search: Record<string, unknown>) => ({
		post_auth_redirect_uri:
			typeof search.post_auth_redirect_uri === "string"
				? search.post_auth_redirect_uri
				: undefined,
	}),
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

		if (mode === AuthContextMode.TokenSetBackend) {
			const snapshot = await ensureTokenSetBackendModeClientReady();
			dashboardAuthenticated = Boolean(snapshot?.tokens.accessToken);
		} else if (mode === AuthContextMode.TokenSetFrontend) {
			const snapshot = await ensureTokenSetFrontendModeClientReady();
			dashboardAuthenticated = Boolean(snapshot?.tokens.accessToken);
		} else if (mode === AuthContextMode.Session) {
			const session = await sessionContextClient.refresh();
			dashboardAuthenticated = session !== null;
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

const tokenSetBackendModePlaygroundRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: TOKEN_SET_BACKEND_MODE_PLAYGROUND_PATH,
	component: TokenSetBackendModePlaygroundRoutePage,
});

const tokenSetFrontendModePlaygroundRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
	component: TokenSetFrontendModePlaygroundRoutePage,
});

const tokenSetFrontendCallbackRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	component: TokenSetFrontendCallbackRoutePage,
});

const tokenSetFrontendPopupCallbackRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH,
	component: TokenSetFrontendModePopupCallbackPage,
});

const sessionPlaygroundRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/playground/session",
	component: SessionPlaygroundRoutePage,
});

const basicAuthPlaygroundRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/playground/basic-auth",
	component: BasicAuthPlaygroundRoutePage,
});

const routeTree = rootRoute.addChildren([
	loginRoute,
	tokenSetBackendModePlaygroundRoute,
	tokenSetFrontendModePlaygroundRoute,
	tokenSetFrontendCallbackRoute,
	tokenSetFrontendPopupCallbackRoute,
	sessionPlaygroundRoute,
	basicAuthPlaygroundRoute,
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

function PlaygroundAccessBoundary({
	expectedMode,
	title,
	loadingMessage,
	children,
}: {
	expectedMode: AuthContextMode;
	title: string;
	loadingMessage: string;
	children: React.ReactNode;
}) {
	const rawMode = useSyncExternalStore(
		subscribeAuthContextMode,
		getAuthContextMode,
		getAuthContextMode,
	);

	if (rawMode !== null && rawMode !== expectedMode) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
				<div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="space-y-1">
						<h2 className="text-base font-semibold">{title}</h2>
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							This reference page requires the{" "}
							<span className="font-medium text-zinc-700 dark:text-zinc-300">
								{expectedMode}
							</span>{" "}
							authentication context. You are currently signed in with a
							different context.
						</p>
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							Sign out first, then return to the login page and choose the
							matching context before using this playground.
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
					{loadingMessage}
				</div>
			}
		>
			{children}
		</Suspense>
	);
}

function TokenSetBackendModePlaygroundRoutePage() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.TokenSetBackend}
			title="Token Set Backend Mode Playground"
			loadingMessage="Loading token-set backend-mode reference page..."
		>
			<TokenSetBackendModePlaygroundPage />
		</PlaygroundAccessBoundary>
	);
}

function TokenSetFrontendModePlaygroundRoutePage() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.TokenSetFrontend}
			title="Token Set Frontend Mode Playground"
			loadingMessage="Loading token-set frontend-mode reference page..."
		>
			<TokenSetFrontendModePlaygroundPage />
		</PlaygroundAccessBoundary>
	);
}

function TokenSetFrontendCallbackRoutePage() {
	const controller = useSecuritydeptContext().get(
		TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
	);
	const state = useTokenSetCallbackResume({
		controller,
		getCurrentUrl: () => window.location.href,
		describeError: (error, options) =>
			describeFrontendOidcModeCallbackError(error, {
				...options,
				recoveryLinks: {
					restart_flow: TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
				},
				recoveryLabels: {
					restart_flow: "Return to frontend-mode playground",
				},
			}),
	});
	const handledResolvedRef = useRef(false);
	const failurePresentation =
		state.state === CallbackResumeStatus.Error
			? describeFrontendOidcModeCallbackError(state.error, {
					recoveryLinks: {
						restart_flow: TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
					},
					recoveryLabels: {
						restart_flow: "Return to frontend-mode playground",
					},
				})
			: null;

	useEffect(() => {
		if (
			state.state === CallbackResumeStatus.Resolved &&
			"data" in state &&
			!handledResolvedRef.current
		) {
			handledResolvedRef.current = true;
			window.location.href = state.data.postAuthRedirectUri ?? "/";
		}
	}, [state]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
			<div className="w-full max-w-lg space-y-4 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
				<div className="space-y-2">
					<p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-400">
						Token Set Frontend Mode Callback
					</p>
					<h1 className="text-2xl font-semibold">
						Completing browser-owned callback
					</h1>
					<p className="text-sm text-zinc-500 dark:text-zinc-400">
						This route is owned by the React SDK callback component. It waits
						for the frontend-mode client to become ready, resumes the OIDC
						callback, then returns you to the stored post-auth redirect.
					</p>
				</div>
				{failurePresentation ? (
					<ErrorPresentationCallout
						descriptor={failurePresentation}
						eyebrow="Callback failure"
					/>
				) : null}
				{state.state === CallbackResumeStatus.Pending ? (
					<p className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
						Warming the frontend-mode client registry and resuming the OIDC
						callback...
					</p>
				) : null}
				{state.state === CallbackResumeStatus.Idle ? (
					<p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-300">
						This URL does not currently carry a recognized frontend-mode
						callback payload.
					</p>
				) : null}
			</div>
		</div>
	);
}

function SessionPlaygroundRoutePage() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.Session}
			title="Session Playground"
			loadingMessage="Loading session reference page..."
		>
			<SessionPlaygroundPage />
		</PlaygroundAccessBoundary>
	);
}

function BasicAuthPlaygroundRoutePage() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.Basic}
			title="Basic Auth Playground"
			loadingMessage="Loading basic-auth reference page..."
		>
			<BasicAuthPlaygroundPage />
		</PlaygroundAccessBoundary>
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
	const tokenSetFrontendModePageEnvironment = useMemo(
		() => createTokenSetFrontendModePageEnvironment(),
		[],
	);
	const basicAuthClient = useMemo(
		() =>
			createBasicAuthContextClient({
				config: basicAuthContextConfig,
				environment: tokenSetFrontendModePageEnvironment,
			}),
		[tokenSetFrontendModePageEnvironment],
	);
	const sessionClient = useMemo(() => sessionContextClient, []);
	const tokenSetClients = useMemo(
		() => [
			{
				key: TOKEN_SET_BACKEND_MODE_CLIENT_KEY,
				clientFactory: tokenSetBackendModeClientFactory,
			},
			{
				key: TOKEN_SET_FRONTEND_MODE_CLIENT_KEY,
				clientFactory: tokenSetFrontendModeClientFactory,
				callbackPath: TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
			},
		],
		[],
	);
	const tokenSetRegistry = useMemo(
		() =>
			SecuritydeptInjector.resolveAndCreate([
				provideTokenSetAuthRegistry({ clients: tokenSetClients }),
			]).get(TOKEN_SET_AUTH_REGISTRY),
		[tokenSetClients],
	);
	const rootInjector = useMemo(
		() =>
			SecuritydeptInjector.resolveAndCreate([
				provideBasicAuthContextClient(basicAuthClient),
				...provideSessionContextClient(sessionClient),
				provideEnvironment({
					environment: tokenSetFrontendModePageEnvironment,
				}),
				provideTokenSetAuthRegistry(tokenSetRegistry),
				provideTokenSetCallbackResumeController(tokenSetRegistry),
			]),
		[
			basicAuthClient,
			sessionClient,
			tokenSetFrontendModePageEnvironment,
			tokenSetRegistry,
		],
	);

	useEffect(() => {
		void sessionClient.start().catch(() => {});
	}, [rootInjector, sessionClient]);

	return (
		<QueryClientProvider client={queryClient}>
			<SecuritydeptProvider injector={rootInjector}>
				<RouterProvider router={router} />
			</SecuritydeptProvider>
		</QueryClientProvider>
	);
}
