import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Lock, LogIn, LogOut, ShieldAlert } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Layout } from "@/components/layout/Layout";
import {
	AuthContextMode,
	clearAuthContextMode,
	getAuthContextMode,
	setAuthContextMode,
	subscribeAuthContextMode,
} from "@/lib/authContext";
import { buildBasicAuthLoginUrl } from "@/lib/basicAuth";

interface BasicAuthProbeResult {
	authenticated: boolean;
	status: number;
	challenge: string | null;
	entryCount: number | null;
}

async function probeBasicAuthStatus(): Promise<BasicAuthProbeResult> {
	const response = await fetch("/basic/api/entries", {
		method: "GET",
		headers: { Accept: "application/json" },
	});

	if (response.ok) {
		const payload = (await response.json().catch(() => [])) as unknown;
		return {
			authenticated: true,
			status: response.status,
			challenge: response.headers.get("WWW-Authenticate"),
			entryCount: Array.isArray(payload) ? payload.length : null,
		};
	}

	return {
		authenticated: false,
		status: response.status,
		challenge: response.headers.get("WWW-Authenticate"),
		entryCount: null,
	};
}

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

export function BasicAuthPlaygroundPage() {
	const rawMode = useSyncExternalStore(
		subscribeAuthContextMode,
		getAuthContextMode,
		getAuthContextMode,
	);
	const probeQuery = useQuery({
		queryKey: ["playground", "basic-auth", "status"],
		queryFn: probeBasicAuthStatus,
		retry: false,
		staleTime: 5_000,
	});
	const loginHref = buildBasicAuthLoginUrl("/playground/basic-auth");
	const logout = useMutation({
		mutationKey: ["playground", "basic-auth", "logout"],
		mutationFn: async () => {
			await fetch("/basic/logout", {
				method: "POST",
				headers: { Accept: "application/json" },
			});
		},
		onSettled: () => {
			clearAuthContextMode();
			window.location.href = "/playground/basic-auth";
		},
	});

	const probeStatus = probeQuery.isLoading
		? "Checking"
		: probeQuery.data?.authenticated
			? "Authenticated"
			: "Challenge required";
	const challengeHeader = probeQuery.data?.challenge ?? "None";
	const protectedProbe = probeQuery.data
		? String(probeQuery.data.status)
		: probeQuery.isLoading
			? "..."
			: "unavailable";

	return (
		<Layout>
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<section className="rounded-[28px] border border-amber-200 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.2),transparent_38%),linear-gradient(135deg,rgba(255,251,235,1),rgba(255,255,255,0.92))] p-8 shadow-sm dark:border-amber-900/60 dark:bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.26),transparent_35%),linear-gradient(135deg,rgba(9,9,11,1),rgba(24,24,27,0.94))]">
					<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
						<div className="max-w-2xl space-y-3">
							<div className="inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 backdrop-blur dark:border-amber-800 dark:bg-zinc-950/40 dark:text-amber-300">
								<Lock className="h-3.5 w-3.5" />
								Basic Auth Playground
							</div>
							<h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
								Challenge-boundary reference page
							</h1>
							<p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
								This page exposes the minimum basic-auth reference surface: the
								dedicated login route, the protected JSON probe, and the logout
								limitation caused by browser-managed credentials.
							</p>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row">
							<a
								href={loginHref}
								onClick={() => setAuthContextMode(AuthContextMode.Basic)}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400"
							>
								<LogIn className="h-4 w-4" />
								Start basic login
							</a>
							<button
								type="button"
								onClick={() => logout.mutate()}
								disabled={logout.isPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white/80 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-200 dark:hover:border-zinc-500"
							>
								<LogOut className="h-4 w-4" />
								Basic logout route
							</button>
						</div>
					</div>
				</section>

				<section className="grid gap-4 md:grid-cols-3">
					<StatusCard
						title="Stored mode"
						value={rawMode ?? "none"}
						description="The local auth-context hint for the current browser tab."
					/>
					<StatusCard
						title="Protected probe"
						value={probeStatus}
						description="Derived from GET /basic/api/entries with Accept: application/json so the app can observe auth state without triggering a native dialog by accident."
					/>
					<StatusCard
						title="HTTP status"
						value={protectedProbe}
						description="200 means cached credentials still satisfy the zone. 401 means the next explicit challenge should go through /basic/login."
					/>
				</section>

				<section className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
					<div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<div className="flex items-center gap-2">
							<ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
							<h2 className="text-lg font-semibold">Auth status visibility</h2>
						</div>
						<div className="mt-4 space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
							<p>
								Basic-auth mode does not expose a normalized principal payload
								in the same way session mode does. The browser owns the
								credential cache, so this reference page shows authenticated vs
								challenge- required status instead of a user profile.
							</p>
							<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									WWW-Authenticate header
								</p>
								<p className="mt-2 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
									{challengeHeader}
								</p>
							</div>
							{typeof probeQuery.data?.entryCount === "number" ? (
								<p>
									The protected probe could read {probeQuery.data.entryCount}{" "}
									auth entries, which confirms the browser is currently sending
									valid cached credentials for the /basic zone.
								</p>
							) : null}
						</div>
					</div>

					<div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<div className="flex items-center gap-2">
							<ExternalLink className="h-4 w-4 text-amber-600 dark:text-amber-400" />
							<h2 className="text-lg font-semibold">Runtime notes</h2>
						</div>
						<div className="mt-4 space-y-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
							<p>
								Use <span className="font-mono text-xs">/basic/login</span> with
								a
								<span className="font-mono text-xs">
									post_auth_redirect_uri
								</span>
								back to
								<span className="font-mono text-xs">
									/playground/basic-auth
								</span>
								to trigger the browser-native challenge explicitly. Ordinary
								JSON API requests should return 401 without{" "}
								<span className="font-mono text-xs">WWW-Authenticate</span> so
								the dialog stays opt-in.
							</p>
							<div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Resolved login URL
								</p>
								<p className="mt-2 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
									{loginHref}
								</p>
							</div>
							<p>
								Use the basic logout button to POST to
								<span className="font-mono text-xs">/basic/logout</span>. This
								clears the app's local auth-context hint, but browser credential
								caches are not guaranteed to disappear immediately.
							</p>
							<button
								type="button"
								onClick={() => void probeQuery.refetch()}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
							>
								Refresh protected probe
							</button>
						</div>
					</div>
				</section>
			</div>
		</Layout>
	);
}
