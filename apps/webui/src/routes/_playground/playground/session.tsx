import { ResourceStatus } from "@securitydept/client";
import { useResourceSnapshot } from "@securitydept/client-react";
import { useSessionContextClient } from "@securitydept/session-context-client-react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { LogIn, LogOut, Shield, Waypoints } from "lucide-react";
import { AuthContextMode } from "@/auth/model";
import { useAuthService } from "@/auth/react";
import { Layout } from "@/components/layout/Layout";
import { PlaygroundAccessBoundary } from "@/routes/_playground/-access-boundary";

export const Route = createFileRoute("/_playground/playground/session")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.Session}
			title="Session playground"
		>
			<SessionPlaygroundContent />
		</PlaygroundAccessBoundary>
	);
}

const LONG_STATUS_VALUE_LENGTH = 80;

function StatusCard({
	title,
	value,
	collapseLongValue = false,
}: {
	title: string;
	value: string;
	collapseLongValue?: boolean;
}) {
	const isCollapsible =
		collapseLongValue && value.length > LONG_STATUS_VALUE_LENGTH;

	return (
		<div className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
				{title}
			</p>
			{isCollapsible ? (
				<details className="group mt-3 min-w-0">
					<summary className="cursor-pointer list-none">
						<span className="line-clamp-2 break-all text-xl font-semibold text-zinc-900 group-open:hidden dark:text-zinc-100">
							{value}
						</span>
						<span className="mt-2 inline-flex text-xs font-medium text-blue-700 group-open:hidden dark:text-blue-300">
							Show full subject
						</span>
						<span className="hidden text-xs font-medium text-blue-700 group-open:inline dark:text-blue-300">
							Hide full subject
						</span>
					</summary>
					<p className="mt-3 max-h-48 overflow-auto break-all rounded-xl bg-zinc-50 p-3 font-mono text-sm text-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-300">
						{value}
					</p>
				</details>
			) : (
				<p className="mt-3 break-all text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
					{value}
				</p>
			)}
		</div>
	);
}

function SessionPlaygroundContent() {
	const authService = useAuthService();
	const router = useRouter();
	const sessionClient = useSessionContextClient();
	const sessionSnapshot = useResourceSnapshot(sessionClient.sessionResource);
	if (
		sessionSnapshot.status === ResourceStatus.LoadingError ||
		sessionSnapshot.status === ResourceStatus.Error
	) {
		throw sessionSnapshot.error;
	}
	const session =
		sessionSnapshot.status === ResourceStatus.Reloading ||
		sessionSnapshot.status === ResourceStatus.Resolved
			? sessionSnapshot.value
			: null;

	const logout = useMutation({
		mutationKey: ["playground", "session", "logout"],
		mutationFn: () => sessionClient.logout(),
		onSuccess: async () => {
			authService.clearMode();
			await router.navigate({ to: "/playground/session" });
		},
	});

	const handleStartLogin = () => {
		void authService.login({
			mode: AuthContextMode.Session,
			postAuthRedirectUri: "/playground/session",
		});
	};

	const principal = session?.principal;
	const authStatus = principal ? "Authenticated" : "Unauthenticated";
	const claims = principal?.claims ?? {};
	const hasClaims = Object.keys(claims).length > 0;

	return (
		<Layout>
			<div className="mx-auto flex max-w-5xl flex-col gap-5">
				<section className="rounded-[28px] border border-blue-200 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.18),transparent_40%),linear-gradient(135deg,rgba(239,246,255,1),rgba(255,255,255,0.92))] p-8 shadow-sm dark:border-blue-900/60 dark:bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.28),transparent_35%),linear-gradient(135deg,rgba(9,9,11,1),rgba(17,24,39,0.94))]">
					<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
						<div className="max-w-xl space-y-3">
							<div className="inline-flex items-center gap-2 rounded-full border border-blue-300/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 backdrop-blur dark:border-blue-800 dark:bg-zinc-950/40 dark:text-blue-300">
								<Shield className="h-3.5 w-3.5" />
								Cookie session
							</div>
							<h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
								Session
							</h1>
							<p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
								Start the server-owned login flow and inspect the normalized
								principal returned by the active cookie session.
							</p>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row">
							<button
								type="button"
								onClick={handleStartLogin}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
							>
								<LogIn className="h-4 w-4" />
								Start login
							</button>
							<button
								type="button"
								onClick={() => logout.mutate()}
								disabled={logout.isPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white/80 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-200 dark:hover:border-zinc-500"
							>
								<LogOut className="h-4 w-4" />
								Logout
							</button>
						</div>
					</div>
				</section>

				<section className="grid gap-4 md:grid-cols-2">
					<StatusCard title="Session status" value={authStatus} />
					<StatusCard
						title="Subject"
						value={principal?.subject ?? "Unavailable"}
						collapseLongValue
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
								<div className="grid gap-3 sm:grid-cols-2">
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
								</div>
								{hasClaims ? (
									<div>
										<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
											Claims
										</p>
										<pre className="mt-1 overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100 dark:bg-zinc-950">
											{JSON.stringify(claims, null, 2)}
										</pre>
									</div>
								) : null}
							</div>
						) : (
							<p className="mt-4 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
								No active session principal.
							</p>
						)}
					</div>

					<div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<h2 className="text-lg font-semibold">Return target</h2>
						<p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
							The login flow returns to this playground after the server creates
							the session.
						</p>
						<p className="mt-4 break-all rounded-xl bg-zinc-50 p-4 font-mono text-xs text-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-300">
							/playground/session
						</p>
					</div>
				</section>
			</div>
		</Layout>
	);
}
