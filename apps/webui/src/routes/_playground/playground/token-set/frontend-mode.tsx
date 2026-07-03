import {
	ClientError,
	type ErrorPresentationDescriptor,
	PopupErrorCode,
	ResourceStatus,
	readErrorPresentationDescriptor,
	readPopupErrorPresentationDescriptor,
	UserRecovery,
} from "@securitydept/client";
import {
	useInteropObservable,
	useResourceSnapshot,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { type FrontendOidcModeClient } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	FlaskConical,
	MonitorUp,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { type AuthService } from "@/auth/auth.service";
import { AuthContextMode } from "@/auth/model";
import { useAuthService } from "@/auth/react";
import { TOKEN_SET_FRONTEND_MODE_CONFIG } from "@/auth/token-set/config";
import { TokenSetTracingService } from "@/auth/token-set/tracing";
import { ErrorPresentationCallout } from "@/components/common/ErrorPresentationCallout";
import { Layout } from "@/components/layout/Layout";
import { PlaygroundAccessBoundary } from "@/routes/_playground/-access-boundary";
import { TraceTimelineSection } from "./-frontend-mode/trace-timeline-section";

export const Route = createFileRoute(
	"/_playground/playground/token-set/frontend-mode",
)({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.TokenSetFrontend}
			title="Token Set frontend-mode playground"
		>
			<TokenSetFrontendModePlaygroundContentLoader />
		</PlaygroundAccessBoundary>
	);
}

function renderTokenPreview(value: string | undefined): string {
	if (!value) {
		return "Unavailable";
	}

	if (value.length <= 32) {
		return value;
	}

	return `${value.slice(0, 16)}...${value.slice(-12)}`;
}

function TokenSetFrontendModePlaygroundContentLoader() {
	const authService = useAuthService();
	const [frontendClient, setFrontendClient] =
		useState<FrontendOidcModeClient | null>(null);

	useEffect(() => {
		let mounted = true;
		void authService.getFrontendOidcClient().then((client) => {
			if (mounted) {
				setFrontendClient(client);
			}
			void client.start();
		});
		return () => {
			mounted = false;
		};
	}, [authService]);

	if (!frontendClient) {
		return (
			<Layout>
				<p className="mx-auto max-w-5xl text-sm text-zinc-500 dark:text-zinc-400">
					Loading token-set frontend-mode client...
				</p>
			</Layout>
		);
	}

	return (
		<TokenSetFrontendModePlaygroundContent
			authService={authService}
			frontendClient={frontendClient}
		/>
	);
}

function TokenSetFrontendModePlaygroundContent({
	authService,
	frontendClient,
}: {
	authService: AuthService;
	frontendClient: FrontendOidcModeClient;
}) {
	const tracingService = useSecuritydeptContext().get(TokenSetTracingService);
	const traceTimeline = tracingService.frontendTimeline;
	const stateSnapshot = useResourceSnapshot(frontendClient.authResource);
	const state =
		stateSnapshot.status === ResourceStatus.Reloading ||
		stateSnapshot.status === ResourceStatus.Resolved
			? stateSnapshot.value
			: null;
	const stateError =
		stateSnapshot.status === ResourceStatus.LoadingError ||
		stateSnapshot.status === ResourceStatus.Error
			? stateSnapshot.error
			: null;
	useInteropObservable(traceTimeline.latestEntry, { initialValue: null });
	const traceEvents = traceTimeline.entries;
	const [error, setError] = useState<ErrorPresentationDescriptor | null>(null);

	useEffect(() => {
		if (state?.tokens.accessToken) {
			authService.setMode(AuthContextMode.TokenSetFrontend);
		}
	}, [authService, state?.tokens.accessToken]);

	function describeHostError(error: unknown): ErrorPresentationDescriptor {
		const options = {
			fallbackTitle: "Frontend-mode action failed",
			fallbackDescription:
				"The frontend-mode reference action could not complete.",
			recoveryLinks: {
				[UserRecovery.RestartFlow]:
					TOKEN_SET_FRONTEND_MODE_CONFIG.paths.playground,
			},
			recoveryLabels: {
				[UserRecovery.RestartFlow]: "Return to frontend-mode playground",
			},
		};
		return error instanceof ClientError &&
			(error.code === PopupErrorCode.Blocked ||
				error.code === PopupErrorCode.Closed)
			? readPopupErrorPresentationDescriptor(error, options)
			: readErrorPresentationDescriptor(error, options);
	}

	const login = useMutation({
		mutationFn: () =>
			frontendClient.loginWithRedirect({
				postAuthRedirectUri: TOKEN_SET_FRONTEND_MODE_CONFIG.paths.playground,
			}),
		onMutate: () => {
			setError(null);
			authService.setMode(AuthContextMode.TokenSetFrontend);
		},
		onError: (error) => setError(describeHostError(error)),
	});
	const popupLogin = useMutation({
		mutationFn: () =>
			frontendClient.loginWithPopup({
				popupCallbackUrl: new URL(
					TOKEN_SET_FRONTEND_MODE_CONFIG.paths.popupCallback,
					frontendClient.config.redirectUri,
				).toString(),
			}),
		onMutate: () => {
			setError(null);
			authService.setMode(AuthContextMode.TokenSetFrontend);
		},
		onError: (error) => setError(describeHostError(error)),
	});
	const refresh = useMutation({
		mutationFn: () => frontendClient.refreshState(),
		onMutate: () => setError(null),
		onError: (error) => setError(describeHostError(error)),
	});
	const clear = useMutation({
		mutationFn: () => frontendClient.logout(),
		onMutate: () => setError(null),
		onError: (error) => setError(describeHostError(error)),
	});
	const actionPending =
		login.isPending ||
		popupLogin.isPending ||
		refresh.isPending ||
		clear.isPending;
	if (stateError !== null) {
		throw stateError;
	}

	return (
		<Layout>
			<div className="mx-auto flex max-w-5xl flex-col gap-5">
				<section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
						<div className="space-y-3">
							<p className="text-xs font-semibold uppercase tracking-[0.26em] text-teal-600 dark:text-teal-400">
								Token Set Frontend Mode
							</p>
							<div className="space-y-2">
								<h1 className="text-3xl font-semibold tracking-tight">
									Frontend OIDC mode
								</h1>
								<p className="max-w-3xl text-sm leading-6 text-zinc-500 dark:text-zinc-400">
									Test redirect and popup login, refresh the resulting token
									set, and inspect the client trace.
								</p>
							</div>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
							<button
								type="button"
								onClick={() => {
									login.mutate();
								}}
								disabled={actionPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-500 disabled:cursor-wait disabled:opacity-70"
							>
								<FlaskConical className="h-4 w-4" />
								Redirect login
							</button>
							<button
								type="button"
								onClick={() => {
									popupLogin.mutate();
								}}
								disabled={actionPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-700 transition-colors hover:border-teal-400 hover:bg-teal-100 disabled:cursor-wait disabled:opacity-70 dark:border-teal-900/80 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:border-teal-700 dark:hover:bg-teal-950/70"
							>
								<MonitorUp className="h-4 w-4" />
								Popup login
							</button>
							<button
								type="button"
								onClick={() => {
									refresh.mutate();
								}}
								disabled={actionPending || !state?.tokens.accessToken}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
							>
								<RefreshCw className="h-4 w-4" />
								Refresh tokens
							</button>
							<button
								type="button"
								onClick={() => {
									clear.mutate();
								}}
								disabled={actionPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-wait disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
							>
								<Trash2 className="h-4 w-4" />
								Clear state
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

				<section className="grid gap-4 lg:grid-cols-3">
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Callback route
						</p>
						<p className="mt-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
							{TOKEN_SET_FRONTEND_MODE_CONFIG.paths.callback}
						</p>
					</div>
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Popup relay route
						</p>
						<p className="mt-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
							{TOKEN_SET_FRONTEND_MODE_CONFIG.paths.popupCallback}
						</p>
					</div>
					<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500 dark:text-zinc-400">
							Access token
						</p>
						<p className="mt-3 font-mono text-sm text-zinc-700 dark:text-zinc-300">
							{renderTokenPreview(state?.tokens.accessToken)}
						</p>
					</div>
				</section>

				<TraceTimelineSection
					events={traceEvents}
					onClear={() => traceTimeline.clear()}
				/>

				<section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div className="space-y-2">
							<h2 className="text-xl font-semibold">Dashboard integration</h2>
							<p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
								Open the protected dashboard with the current access token.
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
