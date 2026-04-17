import {
	type ErrorPresentationDescriptor,
	readErrorPresentationDescriptor,
	UserRecovery,
} from "@securitydept/client";
import { useTokenSetAuthState } from "@securitydept/token-set-context-client-react";
import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	FlaskConical,
	MonitorUp,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ErrorPresentationCallout } from "@/components/common/ErrorPresentationCallout";
import { Layout } from "@/components/layout/Layout";
import { AuthContextMode, setAuthContextMode } from "@/lib/authContext";
import {
	TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH,
	TOKEN_SET_FRONTEND_MODE_CLIENT_KEY,
	TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
	TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH,
} from "@/lib/tokenSetConfig";
import {
	clearTokenSetFrontendModeBrowserState,
	ensureTokenSetFrontendModeClientReady,
	getTokenSetFrontendModeClient,
	startTokenSetFrontendModeLogin,
	startTokenSetFrontendModePopupLogin,
	tokenSetFrontendModeCrossTabStatus,
	tokenSetFrontendModeTraceTimeline,
} from "@/lib/tokenSetFrontendModeClient";
import { TraceTimelineSection } from "@/routes/tokenSetFrontendMode/TraceTimelineSection";

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
	const traceEvents = useSyncExternalStore(
		(listener) => tokenSetFrontendModeTraceTimeline.subscribe(listener),
		() => tokenSetFrontendModeTraceTimeline.get(),
	);
	const crossTabStatus = useSyncExternalStore(
		(onStoreChange) =>
			tokenSetFrontendModeCrossTabStatus.subscribe(onStoreChange),
		() => tokenSetFrontendModeCrossTabStatus.get(),
	);
	const [busy, setBusy] = useState<
		"login" | "popup" | "refresh" | "clear" | null
	>(null);
	const [error, setError] = useState<ErrorPresentationDescriptor | null>(null);

	useEffect(() => {
		void ensureTokenSetFrontendModeClientReady();
	}, []);

	useEffect(() => {
		if (state?.tokens.accessToken) {
			setAuthContextMode(AuthContextMode.TokenSetFrontend);
		}
	}, [state?.tokens.accessToken]);

	function describeHostError(error: unknown): ErrorPresentationDescriptor {
		return readErrorPresentationDescriptor(error, {
			fallbackTitle: "Frontend-mode action failed",
			fallbackDescription:
				"The frontend-mode reference action could not complete.",
			recoveryLinks: {
				[UserRecovery.RestartFlow]: TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
			},
			recoveryLabels: {
				[UserRecovery.RestartFlow]: "Return to frontend-mode playground",
			},
		});
	}

	async function handleLogin() {
		setBusy("login");
		setError(null);
		setAuthContextMode(AuthContextMode.TokenSetFrontend);
		try {
			await startTokenSetFrontendModeLogin(
				TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
			);
		} catch (loginError) {
			setError(describeHostError(loginError));
			setBusy(null);
		}
	}

	async function handlePopupLogin() {
		setBusy("popup");
		setError(null);
		setAuthContextMode(AuthContextMode.TokenSetFrontend);
		try {
			await startTokenSetFrontendModePopupLogin(
				TOKEN_SET_FRONTEND_MODE_PLAYGROUND_PATH,
			);
		} catch (popupError) {
			setError(describeHostError(popupError));
		} finally {
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
			setError(describeHostError(refreshError));
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
			setError(describeHostError(clearError));
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
									Browser-owned popup and callback reference path
								</h1>
								<p className="max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
									This reference route proves the frontend-owned token-set OIDC
									story in the real host app: redirect callback, popup relay,
									and cross-tab lifecycle all land inside the same browser-owned
									host.
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
									void handlePopupLogin();
								}}
								disabled={busy !== null}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-700 transition-colors hover:border-teal-400 hover:bg-teal-100 disabled:cursor-wait disabled:opacity-70 dark:border-teal-900/80 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:border-teal-700 dark:hover:bg-teal-950/70"
							>
								<MonitorUp className="h-4 w-4" />
								Start popup login
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
						<ErrorPresentationCallout
							descriptor={error}
							eyebrow="Frontend-mode action"
							className="mt-4"
						/>
					) : null}
				</section>

				<section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Callback route
						</p>
						<p className="mt-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
							{TOKEN_SET_FRONTEND_MODE_CALLBACK_PATH}
						</p>
						<p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
							The OIDC provider redirects here for the browser-owned callback,
							and the React SDK completes the code exchange on an app route.
						</p>
					</div>
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Popup relay route
						</p>
						<p className="mt-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
							{TOKEN_SET_FRONTEND_MODE_POPUP_CALLBACK_PATH}
						</p>
						<p className="mt-3 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
							Popup login returns to an app-owned relay route that posts the
							callback URL back to this page and closes the popup.
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
							Cross-tab status
						</p>
						<p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
							{crossTabStatus.lastEvent === "idle"
								? "Waiting for another tab to update this frontend-mode client"
								: crossTabStatus.lastEvent === "hydrated"
									? "Another tab updated this frontend-mode client and this page reconciled the persisted snapshot"
									: "Another tab cleared the persisted frontend-mode snapshot and this page dropped its in-memory state"}
						</p>
						<p className="mt-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">
							sync_count={crossTabStatus.syncCount} has_access_token=
							{String(crossTabStatus.hasAccessToken)}
						</p>
					</div>
				</section>

				<TraceTimelineSection
					events={traceEvents}
					onClear={() => tokenSetFrontendModeTraceTimeline.clear()}
				/>

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
