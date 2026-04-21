import { useSessionContext } from "@securitydept/session-context-client-react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, LogIn, LogOut, Shield, Waypoints } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Layout } from "@/components/layout/Layout";
import {
	AuthContextMode,
	clearAuthContextMode,
	getAuthContextMode,
	setAuthContextMode,
	subscribeAuthContextMode,
} from "@/lib/authContext";

function StatusCard({
	title,
	value,
	description,
}: {
	title: string;
	value: string;
	description: string;
}) {
	return (
		<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
				{title}
			</p>
			<p className="mt-3 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
				{value}
			</p>
			<p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
				{description}
			</p>
		</div>
	);
}

export function SessionPlaygroundPage() {
	const rawMode = useSyncExternalStore(
		subscribeAuthContextMode,
		getAuthContextMode,
		getAuthContextMode,
	);
	const {
		client,
		loading,
		logout: logoutCurrentSession,
		session,
	} = useSessionContext();
	const loginHref = client.loginUrl("/playground/session");

	const logout = useMutation({
		mutationKey: ["playground", "session", "logout"],
		mutationFn: logoutCurrentSession,
		onSuccess: () => {
			clearAuthContextMode();
			window.location.href = "/playground/session";
		},
	});

	const handleStartLogin = () => {
		setAuthContextMode(AuthContextMode.Session);
		window.location.href = loginHref;
	};

	const principal = session?.principal;
	const authStatus = loading
		? "Checking"
		: principal
			? "Authenticated"
			: "Unauthenticated";
	const callbackStatus = rawMode === AuthContextMode.Session ? "Armed" : "Idle";

	return (
		<Layout>
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<section className="rounded-[28px] border border-blue-200 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_40%),linear-gradient(135deg,rgba(239,246,255,1),rgba(255,255,255,0.92))] p-8 shadow-sm dark:border-blue-900/60 dark:bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.28),transparent_35%),linear-gradient(135deg,rgba(9,9,11,1),rgba(17,24,39,0.94))]">
					<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
						<div className="max-w-2xl space-y-3">
							<div className="inline-flex items-center gap-2 rounded-full border border-blue-300/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 backdrop-blur dark:border-blue-800 dark:bg-zinc-950/40 dark:text-blue-300">
								<Shield className="h-3.5 w-3.5" />
								Session Playground
							</div>
							<h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
								Cookie-session reference page
							</h1>
							<p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
								This page exposes the minimal session-context runtime surface
								for reference-app parity: current principal, login redirect
								intent, and the cookie-backed authenticated state.
							</p>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row">
							<button
								type="button"
								onClick={handleStartLogin}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
							>
								<LogIn className="h-4 w-4" />
								Start session login
							</button>
							<button
								type="button"
								onClick={() => logout.mutate()}
								disabled={logout.isPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white/80 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-200 dark:hover:border-zinc-500"
							>
								<LogOut className="h-4 w-4" />
								Session logout
							</button>
						</div>
					</div>
				</section>

				<section className="grid gap-4 md:grid-cols-3">
					<StatusCard
						title="Stored mode"
						value={rawMode ?? "none"}
						description="The local auth-context hint used by the dashboard shell before route security runs."
					/>
					<StatusCard
						title="Cookie session"
						value={authStatus}
						description="Derived from the session user-info query. Authenticated means the server still sees a live cookie-backed session."
					/>
					<StatusCard
						title="Callback redirect"
						value={callbackStatus}
						description="This playground saves /playground/session as the post-auth target before sending you into the session login flow."
					/>
				</section>

				<section className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
					<div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<div className="flex items-center gap-2">
							<Waypoints className="h-4 w-4 text-blue-600 dark:text-blue-400" />
							<h2 className="text-lg font-semibold">Current principal</h2>
						</div>
						{principal ? (
							<div className="mt-4 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
								<div>
									<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										Display name
									</p>
									<p className="mt-1 text-base font-medium text-zinc-900 dark:text-zinc-100">
										{principal.displayName}
									</p>
								</div>
								<div>
									<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										Picture
									</p>
									<p className="mt-1 break-all font-mono text-xs">
										{principal.picture ?? "No picture claim"}
									</p>
								</div>
								<div>
									<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										Claims
									</p>
									<pre className="mt-1 overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100 dark:bg-zinc-950">
										{JSON.stringify(principal.claims ?? {}, null, 2)}
									</pre>
								</div>
							</div>
						) : (
							<p className="mt-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
								No active session principal is visible right now. Use the
								session login entry above to create the cookie session, then
								come back to inspect the normalized user-info payload.
							</p>
						)}
					</div>

					<div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<div className="flex items-center gap-2">
							<ExternalLink className="h-4 w-4 text-blue-600 dark:text-blue-400" />
							<h2 className="text-lg font-semibold">Runtime notes</h2>
						</div>
						<div className="mt-4 space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
							<p>
								Session login is still routed through the unified chooser at
								<span className="font-mono text-xs">/login</span>; this page is
								only a reference surface.
							</p>
							<p>
								The start button sends an explicit
								<span className="font-mono text-xs">/playground/session</span>,
								as the session login URL's
								<span className="font-mono text-xs">
									post_auth_redirect_uri
								</span>
								before redirecting.
							</p>
							<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Resolved login URL
								</p>
								<p className="mt-2 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
									{loginHref}
								</p>
							</div>
						</div>
					</div>
				</section>
			</div>
		</Layout>
	);
}
