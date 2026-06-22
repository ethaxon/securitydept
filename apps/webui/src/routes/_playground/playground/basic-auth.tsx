import {
	BasicAuthBoundaryKind as BasicAuthBoundaryKinds,
	type BasicAuthBoundarySnapshot,
} from "@securitydept/basic-auth-context-client";
import { useBasicAuthContextClient } from "@securitydept/basic-auth-context-client-react";
import { type ResourceSnapshot, ResourceStatus } from "@securitydept/client";
import { useResourceSnapshot } from "@securitydept/client-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, Lock, LogIn, LogOut, RefreshCw } from "lucide-react";
import { AuthContextMode } from "@/auth/model";
import { useAuthService } from "@/auth/react";
import { Layout } from "@/components/layout/Layout";
import { PlaygroundAccessBoundary } from "@/routes/_playground/-access-boundary";

export const Route = createFileRoute("/_playground/playground/basic-auth")({
	component: RouteComponent,
});

function RouteComponent() {
	return (
		<PlaygroundAccessBoundary
			expectedMode={AuthContextMode.Basic}
			title="Basic Auth playground"
		>
			<BasicAuthPlaygroundContent />
		</PlaygroundAccessBoundary>
	);
}

type BasicAuthBoundaryKind =
	(typeof BasicAuthBoundaryKinds)[keyof typeof BasicAuthBoundaryKinds];

function StatusMetric({
	label,
	value,
	accent = "text-zinc-950 dark:text-zinc-50",
}: {
	label: string;
	value: string;
	accent?: string;
}) {
	return (
		<div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
				{label}
			</p>
			<p className={`mt-3 text-2xl font-semibold ${accent}`}>{value}</p>
		</div>
	);
}

function ObservationRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex items-center justify-between gap-4 border-b border-zinc-200 py-3 last:border-b-0 dark:border-zinc-800">
			<span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
			<span className="break-all text-right font-mono text-xs text-zinc-800 dark:text-zinc-200">
				{value}
			</span>
		</div>
	);
}

function boundaryValue(
	snapshot: ResourceSnapshot<BasicAuthBoundarySnapshot | null>,
): BasicAuthBoundarySnapshot | null {
	return snapshot.status === ResourceStatus.Reloading ||
		snapshot.status === ResourceStatus.Resolved ||
		snapshot.status === ResourceStatus.Error
		? snapshot.value
		: null;
}

function BasicAuthPlaygroundContent() {
	const authService = useAuthService();
	const basicAuthClient = useBasicAuthContextClient();
	const boundarySnapshot = useResourceSnapshot(
		basicAuthClient.boundaryResource,
	);
	const observedBoundary = boundaryValue(boundarySnapshot);
	const probeQuery = useQuery({
		queryKey: [
			"playground",
			"basic-auth",
			"probe",
			observedBoundary?.authenticated === true,
		],
		queryFn: () => basicAuthClient.refresh(),
		retry: false,
	});
	const logout = useMutation({
		mutationKey: ["playground", "basic-auth", "logout"],
		mutationFn: () => basicAuthClient.logout(),
	});
	const login = useMutation({
		mutationKey: ["playground", "basic-auth", "login"],
		mutationFn: () =>
			authService.login({
				mode: AuthContextMode.Basic,
				postAuthRedirectUri: "/playground/basic-auth",
			}),
	});

	const probeData = probeQuery.data;
	const boundaryKind: BasicAuthBoundaryKind =
		probeData?.boundaryKind ?? BasicAuthBoundaryKinds.Unauthorized;
	const boundaryStatus = probeQuery.isPending
		? "Checking"
		: probeQuery.isError
			? "Probe failed"
			: probeData?.authenticated
				? "Authenticated"
				: "Unauthenticated";
	const httpStatus = probeData ? String(probeData.status) : "-";
	const challengeHeader = probeData?.challengeHeader ?? "None";

	return (
		<Layout>
			<div className="mx-auto flex max-w-5xl flex-col gap-5">
				<section className="rounded-[28px] border border-amber-200 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.2),transparent_38%),linear-gradient(135deg,rgba(255,251,235,1),rgba(255,255,255,0.92))] p-7 shadow-sm dark:border-amber-900/60 dark:bg-[radial-gradient(circle_at_top_left,rgba(217,119,6,0.26),transparent_35%),linear-gradient(135deg,rgba(9,9,11,1),rgba(24,24,27,0.94))] sm:p-8">
					<div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
						<div className="max-w-xl space-y-3">
							<div className="inline-flex items-center gap-2 rounded-full border border-amber-300/70 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 backdrop-blur dark:border-amber-800 dark:bg-zinc-950/40 dark:text-amber-300">
								<Lock className="h-3.5 w-3.5" />
								Browser boundary
							</div>
							<h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
								Basic Auth
							</h1>
							<p className="text-sm leading-6 text-zinc-600 dark:text-zinc-300">
								Trigger the explicit challenge route and inspect the protected
								probe. The client can clear its observation, but the browser
								owns the credential cache.
							</p>
						</div>
						<div className="flex flex-col gap-3 sm:flex-row">
							<button
								type="button"
								onClick={() => login.mutate()}
								disabled={login.isPending}
								className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
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
								Clear observation
							</button>
						</div>
					</div>
				</section>

				<section className="grid gap-4 md:grid-cols-3">
					<StatusMetric
						label="Probe result"
						value={boundaryStatus}
						accent={
							probeData?.authenticated
								? "text-emerald-600 dark:text-emerald-400"
								: "text-zinc-950 dark:text-zinc-50"
						}
					/>
					<StatusMetric label="Boundary" value={boundaryKind} />
					<StatusMetric label="HTTP status" value={httpStatus} />
				</section>

				<section className="grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
					<div
						className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
						data-basic-boundary-kind={boundaryKind}
					>
						<div className="flex items-center gap-2">
							<Activity className="h-4 w-4 text-amber-600 dark:text-amber-400" />
							<h2 className="text-lg font-semibold">Current observation</h2>
						</div>
						<div className="mt-4">
							<ObservationRow label="Probe path" value="/basic/api/entries" />
							<ObservationRow label="Boundary" value={boundaryKind} />
							<ObservationRow label="HTTP status" value={httpStatus} />
							<ObservationRow
								label="WWW-Authenticate"
								value={challengeHeader}
							/>
						</div>
						{probeQuery.isError ? (
							<p className="mt-4 text-sm text-rose-600 dark:text-rose-400">
								The probe failed. Use refresh to try again.
							</p>
						) : null}
					</div>

					<div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-950/60">
						<div className="flex items-center gap-2">
							<RefreshCw className="h-4 w-4 text-zinc-500" />
							<h2 className="text-lg font-semibold">Probe again</h2>
						</div>
						<p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
							After clearing the observation, the next probe shows whether the
							browser still sends its cached credentials.
						</p>
						<button
							type="button"
							onClick={() => void probeQuery.refetch()}
							disabled={probeQuery.isFetching}
							className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-500"
						>
							<RefreshCw
								className={`h-4 w-4 ${probeQuery.isFetching ? "animate-spin" : ""}`}
							/>
							Refresh probe
						</button>
					</div>
				</section>
			</div>
		</Layout>
	);
}
