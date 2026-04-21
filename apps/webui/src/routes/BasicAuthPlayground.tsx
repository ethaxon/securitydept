import {
	BasicAuthBoundaryKind as BasicAuthBoundaryKinds,
	readBasicAuthBoundaryKind,
} from "@securitydept/basic-auth-context-client";
import { useBasicAuthContext } from "@securitydept/basic-auth-context-client-react";
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
import {
	AuthObservationProfileId,
	authObservationProfiles,
	listAuthObservationHierarchy,
} from "@/lib/authObservationHierarchy";

type BasicAuthBoundaryKind =
	(typeof BasicAuthBoundaryKinds)[keyof typeof BasicAuthBoundaryKinds];

interface BasicAuthProbeResult {
	authenticated: boolean;
	boundaryKind: BasicAuthBoundaryKind;
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
			boundaryKind: BasicAuthBoundaryKinds.Authenticated,
			status: response.status,
			challenge: response.headers.get("WWW-Authenticate"),
			entryCount: Array.isArray(payload) ? payload.length : null,
		};
	}
	const challenge = response.headers.get("WWW-Authenticate");

	return {
		authenticated: false,
		boundaryKind: readBasicAuthBoundaryKind({
			status: response.status,
			challengeHeader: challenge,
			requestPath: "/basic/api/entries",
		}),
		status: response.status,
		challenge,
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

function ObservationHierarchyCard({
	profileId,
}: {
	profileId:
		| typeof AuthObservationProfileId.BasicAuthBrowserBoundary
		| typeof AuthObservationProfileId.BrowserHarnessVerifiedEnvironment;
}) {
	const profile = authObservationProfiles[profileId];
	const hierarchy = listAuthObservationHierarchy(profileId);

	return (
		<div
			className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
			data-observation-profile={profile.id}
		>
			<p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
				{profile.title}
			</p>
			<p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
				{profile.summary}
			</p>
			<ol className="mt-4 space-y-2 text-sm text-zinc-700 dark:text-zinc-200">
				{hierarchy.map((level) => (
					<li
						key={level.surface}
						className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60"
					>
						<span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
							L{level.rank}
						</span>{" "}
						{level.label}
					</li>
				))}
			</ol>
		</div>
	);
}

function readObservedBoundarySummary(
	boundaryKind: BasicAuthBoundaryKind | undefined,
): string {
	if (boundaryKind === BasicAuthBoundaryKinds.Authenticated) {
		return "This browser is currently replaying credentials for the /basic zone.";
	}

	if (boundaryKind === BasicAuthBoundaryKinds.Challenge) {
		return "This browser surfaced an explicit Basic Auth challenge on the current probe path.";
	}

	if (boundaryKind === BasicAuthBoundaryKinds.LogoutPoison) {
		return "This browser observed a plain 401 poison response on the logout path without a fresh challenge header.";
	}

	return "The current browser sequence only proves the no-cached-credentials path: protected JSON stayed plain unauthorized without triggering a fresh challenge.";
}

export function BasicAuthPlaygroundPage() {
	const basicAuthClient = useBasicAuthContext();
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
	const loginHref =
		basicAuthClient.loginUrlForZonePrefix("/basic", "/playground/basic-auth") ??
		"/basic/login?post_auth_redirect_uri=%2Fplayground%2Fbasic-auth";
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
		: probeQuery.data?.boundaryKind === BasicAuthBoundaryKinds.Authenticated
			? "Authenticated"
			: probeQuery.data?.boundaryKind === BasicAuthBoundaryKinds.Challenge
				? "Challenge required"
				: "Unauthorized without challenge";
	const challengeHeader = probeQuery.data?.challenge ?? "None";
	const boundaryKind =
		probeQuery.data?.boundaryKind ?? BasicAuthBoundaryKinds.Unauthorized;
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
						description="Derived from GET /basic/api/entries with Accept: application/json so the app can distinguish explicit browser challenge paths from plain unauthorized protocol responses."
					/>
					<StatusCard
						title="Boundary kind"
						value={boundaryKind}
						description="The current browser-observed classification for the protected JSON probe. This is host evidence, not a wider protocol guarantee."
					/>
					<StatusCard
						title="HTTP status"
						value={protectedProbe}
						description="200 means cached credentials still satisfy the zone. 401 means the next explicit challenge should go through /basic/login."
					/>
				</section>

				<section className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
					<div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-6 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/30">
						<div className="flex items-center gap-2">
							<ShieldAlert className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
							<h2 className="text-lg font-semibold">
								Guaranteed protocol contract
							</h2>
						</div>
						<div className="mt-4 space-y-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
							<p>
								The explicit{" "}
								<span className="font-mono text-xs">/basic/login</span> path
								must preserve a <span className="font-mono text-xs">401</span>{" "}
								with <span className="font-mono text-xs">WWW-Authenticate</span>{" "}
								so the browser can trigger an opt-in Basic Auth challenge.
							</p>
							<p>
								The <span className="font-mono text-xs">/basic/logout</span>{" "}
								path must preserve a plain{" "}
								<span className="font-mono text-xs">401</span> poison response
								without{" "}
								<span className="font-mono text-xs">WWW-Authenticate</span>.
							</p>
							<p>
								Protected JSON probes inside the{" "}
								<span className="font-mono text-xs">/basic</span> zone should
								remain plain unauthorized when no explicit challenge is
								intended.
							</p>
						</div>
					</div>

					<div
						className="rounded-2xl border border-sky-200 bg-sky-50/80 p-6 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/30"
						data-basic-boundary-kind={boundaryKind}
					>
						<div className="flex items-center gap-2">
							<ExternalLink className="h-4 w-4 text-sky-700 dark:text-sky-300" />
							<h2 className="text-lg font-semibold">
								Observed in this browser
							</h2>
						</div>
						<div className="mt-4 space-y-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
							<p>
								{readObservedBoundarySummary(probeQuery.data?.boundaryKind)}
							</p>
							<p>
								The current sequence only proves the no-cached-credentials path
								plus the protocol headers we can observe directly in the
								browser.
							</p>
							<p>
								Under Chromium automation, the explicit{" "}
								<span className="font-mono text-xs">/basic/login</span>{" "}
								challenge escalated into a browser auth error before any page
								content rendered.
							</p>
							<p>
								Under the canonical distrobox-hosted WebKit baseline, that same
								explicit <span className="font-mono text-xs">/basic/login</span>
								challenge commits a visible{" "}
								<span className="font-mono text-xs">401</span>
								response with{" "}
								<span className="font-mono text-xs">WWW-Authenticate</span>
								instead of surfacing a browser-thrown auth error.
							</p>
							<p>
								Browser credential-cache eviction after an authenticated logout
								remains browser-observed debt, not a protocol guarantee.
							</p>
						</div>
					</div>
				</section>

				<section className="grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
					<div
						className="rounded-2xl border border-cyan-200 bg-cyan-50/80 p-6 shadow-sm dark:border-cyan-900/60 dark:bg-cyan-950/30"
						data-harness-verified-browser="chromium"
					>
						<div className="flex items-center gap-2">
							<ExternalLink className="h-4 w-4 text-cyan-700 dark:text-cyan-300" />
							<h2 className="text-lg font-semibold">
								Verified browser baseline
							</h2>
						</div>
						<div className="mt-4 space-y-4 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
							<p>
								Chromium and Firefox currently keep the host-native browser path
								as the primary-authority baseline for Basic Auth evidence. Their
								distrobox-hosted path remains not-adopted because the host
								baseline is already verified.
							</p>
							<p>
								WebKit now also has a verified Basic Auth baseline under the
								canonical distrobox-hosted Ubuntu path, but its
								no-cached-credentials challenge surface diverges from Chromium
								and Firefox: the explicit challenge commits a 401 response
								instead of throwing a browser auth error before page render.
							</p>
							<div
								className="rounded-xl border border-cyan-200/80 bg-white/70 p-4 dark:border-cyan-900/60 dark:bg-zinc-950/30"
								data-verified-scenario="basic-auth.challenge.no-cached-credentials"
								data-verified-path-kind="browser-native"
							>
								<p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
									Chromium / no cached credentials
								</p>
								<p className="mt-2">
									The verified unauthenticated path is: explicit
									<span className="font-mono text-xs"> /basic/login </span>
									escalates into a browser auth error, protected JSON remains
									plain unauthorized, and
									<span className="font-mono text-xs"> /basic/logout </span>
									stays plain <span className="font-mono text-xs">401</span>
									without{" "}
									<span className="font-mono text-xs">WWW-Authenticate</span>.
								</p>
							</div>
							<div
								className="rounded-xl border border-cyan-200/80 bg-white/70 p-4 dark:border-cyan-900/60 dark:bg-zinc-950/30"
								data-verified-scenario="basic-auth.logout.authorization-header-harness"
								data-verified-path-kind="harness-backed"
							>
								<p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
									Chromium / authorization-header harness
								</p>
								<p className="mt-2">
									The verified authenticated logout path uses a browser context
									that injects{" "}
									<span className="font-mono text-xs">Authorization</span>. With
									that harness, the protected backend probe reaches
									<span className="font-mono text-xs">200</span> before logout,
									<span className="font-mono text-xs">/basic/logout</span>
									still returns plain{" "}
									<span className="font-mono text-xs">401</span>
									without challenge, and the same harness keeps the next
									protected probe authenticated after logout because it
									continues to send credentials.
								</p>
							</div>
						</div>
					</div>

					<div
						className="rounded-2xl border border-rose-200 bg-rose-50/80 p-6 shadow-sm dark:border-rose-900/60 dark:bg-rose-950/30"
						data-harness-blocked-browsers="webkit"
					>
						<div className="flex items-center gap-2">
							<ShieldAlert className="h-4 w-4 text-rose-700 dark:text-rose-300" />
							<h2 className="text-lg font-semibold">Remaining unknowns</h2>
						</div>
						<div className="mt-4 space-y-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
							<p>
								The browser harness currently detects Chromium, Firefox, and a
								configured WebKit runtime. On Linux non-Debian/Ubuntu hosts,
								host-native WebKit can still block before auth-flow when the
								runtime probe reports missing host dependencies, but the
								canonical distrobox-hosted Ubuntu path now carries a complete
								verified Basic Auth baseline.
							</p>
							<p>
								That host-native WebKit outcome remains formal host-truth, while
								the repo-provided distrobox-hosted Ubuntu baseline is the
								canonical recovery path for verified browser-owned evidence.
							</p>
							<p>
								Native browser-managed Basic Auth credential-cache eviction
								after an authenticated logout remains unverified. The current
								authenticated sequence uses a formal harness that keeps sending
								credentials explicitly.
							</p>
							<p>
								The remaining WebKit-specific divergence is now narrower and
								more explicit: the distrobox-hosted WebKit browser preserves the
								challenge as a committed 401 response with
								<span className="font-mono text-xs">WWW-Authenticate</span>,
								while Chromium and Firefox surface browser-owned auth failure
								channels earlier in the flow.
							</p>
							<p>
								Browser-specific divergence is now explicit even before WebKit
								launches successfully: Chromium and Firefox share the current
								no-cached-credentials baseline, but the top-level challenge
								failure still surfaces through browser-owned error channels
								rather than one shared HTML outcome.
							</p>
							<p>
								This is why the current policy does not flatten every browser
								into distrobox: Chromium and Firefox already hold the
								primary-authority host baseline, while WebKit alone needs the
								canonical recovery path.
							</p>
						</div>
					</div>
				</section>

				<section
					className="grid gap-4 lg:grid-cols-2"
					data-testid="basic-auth-observation-hierarchy"
				>
					<ObservationHierarchyCard
						profileId={AuthObservationProfileId.BasicAuthBrowserBoundary}
					/>
					<ObservationHierarchyCard
						profileId={
							AuthObservationProfileId.BrowserHarnessVerifiedEnvironment
						}
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
								protocol-boundary status instead of a user profile.
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
								caches are not guaranteed to disappear immediately. Treat any
								post-logout credential loss as browser-observed behavior rather
								than as a protocol guarantee.
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
