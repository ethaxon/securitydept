import { useTokenSetAuthState } from "@securitydept/token-set-context-client-react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, FlaskConical, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Layout } from "@/components/layout/Layout";
import { AuthContextMode, setAuthContextMode } from "@/lib/authContext";
import {
	TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	TOKEN_SET_FRONTEND_MODE_CLIENT_KEY,
	TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
} from "@/lib/tokenSetConfig";
import {
	clearTokenSetFrontendModeBrowserState,
	getTokenSetFrontendModeClient,
	startTokenSetFrontendModeLogin,
} from "@/lib/tokenSetFrontendModeClient";

function renderTokenPreview(value: string | undefined): string {
	if (!value) {
		return "Unavailable";
	}

	if (value.length <= 32) {
		return value;
	}

	return `${value.slice(0, 16)}...${value.slice(-12)}`;
}

export function TokenSetFrontendModePlaygroundPage() {
	const state = useTokenSetAuthState(TOKEN_SET_FRONTEND_MODE_CLIENT_KEY);
	const [busy, setBusy] = useState<"login" | "refresh" | "clear" | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (state?.tokens.accessToken) {
			setAuthContextMode(AuthContextMode.TokenSetFrontend);
		}
	}, [state?.tokens.accessToken]);

	async function handleLogin() {
		setBusy("login");
		setError(null);
		setAuthContextMode(AuthContextMode.TokenSetFrontend);
		try {
			await startTokenSetFrontendModeLogin(
				TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
			);
		} catch (loginError) {
			setError(
				loginError instanceof Error
					? loginError.message
					: "Failed to start frontend-mode login.",
			);
			setBusy(null);
		}
	}

	async function handleRefresh() {
		setBusy("refresh");
		setError(null);
		try {
			const client = await getTokenSetFrontendModeClient();
			await client.refresh();
		} catch (refreshError) {
			setError(
				refreshError instanceof Error
					? refreshError.message
					: "Failed to refresh frontend-mode tokens.",
			);
		} finally {
			setBusy(null);
		}
	}

	async function handleClear() {
		setBusy("clear");
		setError(null);
		try {
			await clearTokenSetFrontendModeBrowserState();
		} catch (clearError) {
			setError(
				clearError instanceof Error
					? clearError.message
					: "Failed to clear frontend-mode browser state.",
			);
		} finally {
			setBusy(null);
		}
	}

	return (
		<Layout>
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-600 dark:text-teal-400">
								Token Set Frontend Mode
							</p>
							<div className="space-y-2">
								<h1 className="text-3xl font-semibold tracking-tight">
									Browser-owned callback reference path
								</h1>
								<p className="max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
									This reference route proves the frontend-owned token-set OIDC
									story in the real host app: config projection comes from the
									server, the callback lands on a browser route, and dashboard
									API calls later reuse the same bearer-bearing client.
								</p>
							</div>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
							<button
								type="button"
								onClick={() => {
									void handleLogin();
								}}
								disabled={busy !== null}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-wait disabled:opacity-70"
							>
								<FlaskConical className="h-4 w-4" />
								Start frontend-mode login
							</button>
							<button
								type="button"
								onClick={() => {
									void handleRefresh();
								}}
								disabled={busy !== null || !state?.tokens.accessToken}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
							>
								<RefreshCw className="h-4 w-4" />
								Refresh tokens
							</button>
							<button
								type="button"
								onClick={() => {
									void handleClear();
								}}
								disabled={busy !== null}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
							>
								<Trash2 className="h-4 w-4" />
								Forget frontend-mode state
							</button>
						</div>
					</div>
					{error ? (
						<div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-300">
							{error}
						</div>
					) : null}
				</section>

				<section className="grid gap-4 lg:grid-cols-3">
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Callback route
						</p>
						<p className="mt-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
							{TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH}
						</p>
						<p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
							The OIDC provider redirects here, and the route is completed by
							the React SDK callback component on a dedicated auth callback path
							rather than the playground host route.
						</p>
					</div>
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Access token
						</p>
						<p className="mt-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
							{renderTokenPreview(state?.tokens.accessToken)}
						</p>
						<p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
							Dashboard API calls and TanStack route security both read from
							this same frontend-mode client.
						</p>
					</div>
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Post-auth path
						</p>
						<p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
							Default redirect: frontend-mode playground
						</p>
						<p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
							After callback resolution, the page returns to the stored
							redirect, which keeps the frontend-mode auth story honest inside
							the host app.
						</p>
					</div>
				</section>

				<section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div className="space-y-2">
							<h2 className="text-xl font-semibold">
								Bearer integration result
							</h2>
							<p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
								Once this frontend-mode client holds an access token, the
								protected dashboard routes reuse it through the same token-set
								React Query integration that backend mode uses. That is the
								host-level proof for frontend bearer integration in this
								iteration.
							</p>
						</div>
						<Link
							to="/"
							className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
						>
							Open protected dashboard
							<ArrowRight className="h-4 w-4" />
						</Link>
					</div>
				</section>
			</div>
		</Layout>
	);
}
