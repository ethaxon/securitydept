import {
	type CancellationTokenSourceTrait,
	ClientErrorKind,
	createCancellationTokenSource,
	type ErrorPresentationDescriptor,
	type ResourceTrait,
	readErrorPresentationDescriptor,
	UserRecovery,
	type UserRecovery as UserRecoveryType,
} from "@securitydept/client";
import {
	useResourceValue,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import {
	type BaseOidcModeClient,
	type TokenSetAuthSnapshot,
} from "@securitydept/token-set-context-client/orchestration";
import { TOKEN_SET_CLIENT_REGISTRY } from "@securitydept/token-set-context-client-react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Suspense,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	assessPropagationProbeResult,
	DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET,
	DEFAULT_PROPAGATION_PROBE_PATH,
	probePropagationRouteWithTokenSet,
} from "@/api/tokenSet";
import { type AuthService } from "@/auth/auth.service";
import { AuthContextMode } from "@/auth/model";
import { useAuthService } from "@/auth/react";
import { TOKEN_SET_BACKEND_MODE_CONFIG } from "@/auth/token-set/config";
import { TokenSetTracingService } from "@/auth/token-set/tracing";
import { ErrorPresentationCallout } from "@/components/common/ErrorPresentationCallout";
import { Layout } from "@/components/layout/Layout";
import { PlaygroundAccessBoundary } from "@/routes/_playground/-access-boundary";
import {
	createTokenSetBackendHostTraceRecorder,
	readTokenSetTraceErrorFields,
} from "./-backend-mode/app-trace";
import { TraceTimelineSection } from "./-backend-mode/trace-timeline-section";

export const Route = createFileRoute(
	"/_playground/playground/token-set/backend-mode",
)({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.TokenSetBackend}
			title="Token Set backend-mode playground"
		>
			<TokenSetBackendModePlaygroundContent />
		</PlaygroundAccessBoundary>
	);
}

const PropagationStatusKind = {
	Idle: "idle",
	Loading: "loading",
	Ready: "ready",
	Cancelled: "cancelled",
	Error: "error",
} as const;

type PropagationStatus =
	| { kind: typeof PropagationStatusKind.Idle }
	| { kind: typeof PropagationStatusKind.Loading }
	| {
			kind: typeof PropagationStatusKind.Ready;
			status: number;
			summary: string;
			configStatus: string | null;
			recommendedConfigSnippet: string | null;
	  }
	| { kind: typeof PropagationStatusKind.Cancelled }
	| {
			kind: typeof PropagationStatusKind.Error;
			message: string;
			recovery: UserRecoveryType;
	  };

const DEFAULT_PROPAGATION_DIRECTIVE =
	"by=dashboard;for=local-health;host=localhost:7021;proto=http";

function readErrorDetails(
	error: unknown,
	fallbackDescription: string,
): {
	message: string;
	recovery: UserRecoveryType;
} {
	const descriptor = readErrorPresentationDescriptor(error, {
		fallbackTitle: "Backend-mode action failed",
		fallbackDescription,
	});

	return {
		message: descriptor.description,
		recovery: descriptor.recovery,
	};
}

function CollapsibleTokenCell({
	label,
	value,
}: {
	label: string;
	value: string | null | undefined;
}) {
	const [open, setOpen] = useState(false);
	const preview =
		value && value.length > 24
			? `${value.slice(0, 12)}...${value.slice(-8)}`
			: (value ?? "Unavailable");

	return (
		<div className="min-w-0 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
			<div className="flex items-center justify-between gap-2">
				<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
					{label}
				</p>
				{value ? (
					<button
						type="button"
						onClick={() => setOpen((current) => !current)}
						className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
					>
						{open ? "Collapse" : "Expand"}
					</button>
				) : null}
			</div>
			{open ? (
				<p className="mt-2 break-all font-mono text-sm">{value}</p>
			) : (
				<p className="mt-2 truncate font-mono text-sm text-zinc-500 dark:text-zinc-400">
					{preview}
				</p>
			)}
		</div>
	);
}

function readMetadata(snapshot: TokenSetAuthSnapshot | null): string {
	return JSON.stringify(snapshot?.metadata ?? {}, null, 2);
}

function isCancelledClientError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"kind" in error &&
		error.kind === ClientErrorKind.Cancelled
	);
}

function describePropagationStatus(status: PropagationStatus): string {
	switch (status.kind) {
		case PropagationStatusKind.Idle:
			return "Probe the propagation boundary with the current backend-mode bearer.";
		case PropagationStatusKind.Loading:
			return "Probing propagation forwarding route...";
		case PropagationStatusKind.Ready:
			return status.summary;
		case PropagationStatusKind.Cancelled:
			return "Propagation probe was cancelled.";
		case PropagationStatusKind.Error:
			return status.message;
	}
}

function TokenSetBackendModePlaygroundContent() {
	const registry = useSecuritydeptContext().get(TOKEN_SET_CLIENT_REGISTRY);
	const authService = useAuthService();
	const clientResource = useMemo(
		() => registry.clientResourceFor(TOKEN_SET_BACKEND_MODE_CONFIG.clientKey),
		[registry],
	);

	return (
		<Suspense
			fallback={
				<Layout>
					<p className="mx-auto max-w-5xl text-sm text-zinc-500 dark:text-zinc-400">
						Loading token-set backend-mode client...
					</p>
				</Layout>
			}
		>
			<TokenSetBackendModePlaygroundResolvedContent
				authService={authService}
				clientResource={clientResource}
			/>
		</Suspense>
	);
}

function TokenSetBackendModePlaygroundResolvedContent({
	authService,
	clientResource,
}: {
	authService: AuthService;
	clientResource: ResourceTrait<BaseOidcModeClient>;
}) {
	const client = useResourceValue(clientResource);
	return (
		<TokenSetBackendModePlaygroundReadyContent
			authService={authService}
			client={client}
		/>
	);
}

function TokenSetBackendModePlaygroundReadyContent({
	authService,
	client,
}: {
	authService: AuthService;
	client: BaseOidcModeClient;
}) {
	const tracingService = useSecuritydeptContext().get(TokenSetTracingService);
	const traceTimeline = tracingService.backendTimeline;
	const recordAppTrace = useMemo(
		() =>
			createTokenSetBackendHostTraceRecorder(
				tracingService.tracing,
				tracingService.backendHostSpan,
			),
		[tracingService],
	);
	const state = useResourceValue(client.authResource);
	const authorizationHeader = useResourceValue(client.authorizationHeaderValue);
	const traceEvents = useSyncExternalStore(
		(listener) => traceTimeline.subscribe(listener),
		() => traceTimeline.get(),
	);
	const propagationRequestRef = useRef<CancellationTokenSourceTrait | null>(
		null,
	);
	const [actionError, setActionError] =
		useState<ErrorPresentationDescriptor | null>(null);
	const [propagationDirective, setPropagationDirective] = useState(
		DEFAULT_PROPAGATION_DIRECTIVE,
	);
	const [propagationPath, setPropagationPath] = useState(
		DEFAULT_PROPAGATION_PROBE_PATH,
	);
	const [propagationStatus, setPropagationStatus] = useState<PropagationStatus>(
		{ kind: PropagationStatusKind.Idle },
	);
	const login = useMutation({
		mutationFn: () => {
			authService.setMode(AuthContextMode.TokenSetBackend);
			return client.loginWithRedirect({
				postAuthRedirectUri: TOKEN_SET_BACKEND_MODE_CONFIG.paths.playground,
			});
		},
	});
	const refresh = useMutation({
		mutationFn: () => client.refreshState(),
		onMutate: () => setActionError(null),
		onError: (error) => {
			setActionError(
				readErrorPresentationDescriptor(error, {
					fallbackTitle: "Token refresh failed",
					fallbackDescription:
						"The backend-mode client could not refresh the current token set.",
				}),
			);
		},
	});
	const clear = useMutation({
		mutationFn: async () => {
			propagationRequestRef.current?.cancel();
			propagationRequestRef.current = null;
			await client.logout();
			authService.clearMode();
			setPropagationDirective(DEFAULT_PROPAGATION_DIRECTIVE);
			setPropagationPath(DEFAULT_PROPAGATION_PROBE_PATH);
			setPropagationStatus({ kind: PropagationStatusKind.Idle });
		},
		onMutate: () => setActionError(null),
		onError: (error) => {
			setActionError(
				readErrorPresentationDescriptor(error, {
					fallbackTitle: "Failed to clear token-set state",
					fallbackDescription:
						"The backend-mode client could not clear the current browser-owned token state.",
				}),
			);
		},
	});
	const authActionPending =
		login.isPending || refresh.isPending || clear.isPending;

	useEffect(() => {
		if (state?.tokens.accessToken) {
			authService.setMode(AuthContextMode.TokenSetBackend);
		}
	}, [authService, state?.tokens.accessToken]);

	useEffect(
		() => () => {
			propagationRequestRef.current?.cancel();
			propagationRequestRef.current = null;
		},
		[],
	);

	async function handleProbePropagationRoute() {
		if (propagationRequestRef.current) {
			recordAppTrace("token_set.app.propagation_probe.cancel_requested", {
				reason: "superseded",
				path: propagationPath,
			});
		}
		propagationRequestRef.current?.cancel();
		const cancellation = createCancellationTokenSource();
		propagationRequestRef.current = cancellation;
		setPropagationStatus({ kind: PropagationStatusKind.Loading });
		recordAppTrace("token_set.app.propagation_probe.started", {
			path: propagationPath,
			directive: propagationDirective,
		});

		try {
			const result = await probePropagationRouteWithTokenSet(
				client,
				propagationDirective,
				{
					transport: authService.transport,
					cancellationToken: cancellation.token,
					path: propagationPath,
				},
			);
			if (propagationRequestRef.current !== cancellation) {
				return;
			}
			const assessment = assessPropagationProbeResult(
				result.status,
				result.body,
			);
			setPropagationStatus({
				kind: PropagationStatusKind.Ready,
				status: result.status,
				summary: assessment.summary,
				configStatus: assessment.configStatus,
				recommendedConfigSnippet: assessment.recommendedConfigSnippet,
			});
			recordAppTrace("token_set.app.propagation_probe.succeeded", {
				path: propagationPath,
				status: result.status,
				configStatus: assessment.configStatus,
			});
		} catch (error) {
			if (propagationRequestRef.current !== cancellation) {
				return;
			}
			if (isCancelledClientError(error)) {
				setPropagationStatus({ kind: PropagationStatusKind.Cancelled });
				recordAppTrace("token_set.app.propagation_probe.cancelled", {
					path: propagationPath,
				});
				return;
			}
			const details = readErrorDetails(
				error,
				"Failed to probe propagation route",
			);
			setPropagationStatus({
				kind: PropagationStatusKind.Error,
				message: details.message,
				recovery: details.recovery,
			});
			recordAppTrace("token_set.app.propagation_probe.failed", {
				path: propagationPath,
				...readTokenSetTraceErrorFields(
					error,
					"Failed to probe propagation route",
				),
			});
		} finally {
			if (propagationRequestRef.current === cancellation) {
				propagationRequestRef.current = null;
			}
		}
	}

	return (
		<Layout>
			<div className="mx-auto max-w-6xl space-y-6">
				<section className="rounded-[28px] border border-emerald-200 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.2),transparent_38%),linear-gradient(135deg,rgba(236,253,245,1),rgba(255,255,255,0.94))] p-8 shadow-sm dark:border-emerald-900/60 dark:bg-[radial-gradient(circle_at_top_left,rgba(5,150,105,0.24),transparent_35%),linear-gradient(135deg,rgba(9,9,11,1),rgba(16,24,39,0.94))]">
					<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
						<div className="max-w-3xl space-y-3">
							<div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700 backdrop-blur dark:border-emerald-800 dark:bg-zinc-950/40 dark:text-emerald-300">
								Token Set Backend Mode Playground
							</div>
							<h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
								Backend-mode client diagnostics
							</h1>
							<p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
								Inspect backend OIDC login, refresh, local logout, token state,
								bearer propagation, and tracing. Auth entries and groups are
								application data and remain in the dashboard.
							</p>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row">
							<button
								type="button"
								onClick={() => login.mutate()}
								disabled={authActionPending}
								className="inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
							>
								Start Backend-Mode Flow
							</button>
							<button
								type="button"
								onClick={() => refresh.mutate()}
								disabled={authActionPending || !state?.tokens.refreshMaterial}
								className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white/80 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-200 dark:hover:border-zinc-500"
							>
								{refresh.isPending ? "Refreshing..." : "Refresh Now"}
							</button>
							<button
								type="button"
								onClick={() => clear.mutate()}
								disabled={authActionPending}
								className="inline-flex items-center justify-center rounded-xl border border-zinc-300 bg-white/80 px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-200 dark:hover:border-zinc-500"
							>
								{clear.isPending ? "Clearing..." : "Forget Backend Mode State"}
							</button>
						</div>
					</div>
				</section>

				<div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
					<section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<div className="mb-4">
							<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Runtime State
							</h2>
							<p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
								Token state: {state ? "available" : "empty"}
							</p>
						</div>
						{actionError ? (
							<ErrorPresentationCallout
								descriptor={actionError}
								eyebrow="Backend-mode action"
								className="mb-4"
							/>
						) : null}
						<div className="grid gap-3 sm:grid-cols-2">
							<CollapsibleTokenCell
								label="Access Token"
								value={state?.tokens.accessToken}
							/>
							<CollapsibleTokenCell
								label="ID Token"
								value={state?.tokens.idToken}
							/>
							<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Refresh Token
								</p>
								<p className="mt-2 font-mono text-sm">
									{state?.tokens.refreshMaterial ? "Available" : "Unavailable"}
								</p>
							</div>
							<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
								<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Expires At
								</p>
								<p className="mt-2 break-all font-mono text-xs leading-5 text-zinc-600 dark:text-zinc-300">
									{state?.tokens.accessTokenExpiresAt ?? "Unavailable"}
								</p>
							</div>
							<CollapsibleTokenCell
								label="Authorization Header"
								value={authorizationHeader}
							/>
						</div>
					</section>

					<section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
						<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
							Metadata
						</h2>
						<pre className="mt-4 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100">
							{readMetadata(state)}
						</pre>
					</section>
				</div>

				<section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Propagation Route Probe
							</h2>
							<p className="mt-1 max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
								Exercise the propagation boundary with the current backend-mode
								bearer and an explicit forwarding directive. This probe does not
								read or mutate dashboard business data.
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => void handleProbePropagationRoute()}
								disabled={
									propagationStatus.kind === PropagationStatusKind.Loading ||
									!state?.tokens.accessToken
								}
								className="rounded-md bg-cyan-700 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
							>
								{propagationStatus.kind === PropagationStatusKind.Loading
									? "Probing..."
									: "Probe Propagation Route"}
							</button>
							<button
								type="button"
								onClick={() => propagationRequestRef.current?.cancel()}
								disabled={
									propagationStatus.kind !== PropagationStatusKind.Loading
								}
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
							>
								Cancel Probe
							</button>
						</div>
					</div>

					<div className="mt-4 grid gap-4 lg:grid-cols-3">
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Propagation Route
							</p>
							<input
								type="text"
								value={propagationPath}
								onChange={(event) => setPropagationPath(event.target.value)}
								className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
							/>
							<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
								The default route forwards to the same server's health endpoint.
							</p>
						</div>
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Propagation Directive
							</p>
							<textarea
								value={propagationDirective}
								onChange={(event) =>
									setPropagationDirective(event.target.value)
								}
								rows={3}
								className="mt-3 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
							/>
							<pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
								{DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET}
							</pre>
						</div>
						<div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
							<p className="text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
								Probe Result
							</p>
							<p className="mt-2 text-sm">
								{describePropagationStatus(propagationStatus)}
							</p>
							{propagationStatus.kind === PropagationStatusKind.Ready ? (
								<>
									<p className="mt-3 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										HTTP Status: {propagationStatus.status}
									</p>
									{propagationStatus.configStatus ? (
										<p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
											{propagationStatus.configStatus}
										</p>
									) : null}
									{propagationStatus.recommendedConfigSnippet ? (
										<pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
											{propagationStatus.recommendedConfigSnippet}
										</pre>
									) : null}
								</>
							) : null}
							{propagationStatus.kind === PropagationStatusKind.Error &&
							propagationStatus.recovery !== UserRecovery.None ? (
								<p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
									Recovery: {propagationStatus.recovery}
								</p>
							) : null}
						</div>
					</div>
				</section>

				<TraceTimelineSection
					events={traceEvents}
					onClear={() => traceTimeline.clear()}
				/>
			</div>
		</Layout>
	);
}
