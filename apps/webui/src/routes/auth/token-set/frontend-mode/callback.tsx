import {
	ClientError,
	ClientErrorKind,
	ENVIRONMENT_TOKEN,
	ResourceStatus,
	RouterNavigationIntent,
	RouterNavigationMode,
	UriReferenceString,
} from "@securitydept/client";
import { useSecuritydeptContext } from "@securitydept/client-react";
import { describeFrontendOidcModeCallbackError } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { OidcModeCallbackHandlingKind } from "@securitydept/token-set-context-client/orchestration";
import { useTokenSetFrontendCallback } from "@securitydept/token-set-context-client-react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { TOKEN_SET_FRONTEND_MODE_CONFIG } from "@/auth/token-set/config";
import { ErrorPresentationCallout } from "@/components/common/ErrorPresentationCallout";

export const Route = createFileRoute("/auth/token-set/frontend-mode/callback")({
	component: RouteComponent,
});

function RouteComponent() {
	const environment = useSecuritydeptContext().get(ENVIRONMENT_TOKEN);
	const router = environment.router;
	if (!router) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			code: "webui.frontend_oidc.callback_router_unavailable",
			message: "The frontend OIDC callback route requires environment.router",
			source: "webui",
		});
	}
	const { state } = useTokenSetFrontendCallback();
	const handledResolvedRef = useRef(false);
	const failurePresentation =
		state.status === ResourceStatus.LoadingError ||
		state.status === ResourceStatus.Error
			? describeFrontendOidcModeCallbackError(state.error, {
					recoveryLinks: {
						restart_flow: TOKEN_SET_FRONTEND_MODE_CONFIG.paths.playground,
					},
					recoveryLabels: {
						restart_flow: "Return to frontend-mode playground",
					},
				})
			: null;

	useEffect(() => {
		if (
			state.status === ResourceStatus.Resolved &&
			state.value.kind === OidcModeCallbackHandlingKind.Handled &&
			!handledResolvedRef.current
		) {
			handledResolvedRef.current = true;
			void router.navigate({
				url: UriReferenceString.parse(
					state.value.result.postAuthRedirectUri ?? "/",
				),
				intent: RouterNavigationIntent.AuthRedirect,
				mode: RouterNavigationMode.External,
			});
		}
	}, [router, state]);

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
						This route waits for the frontend-mode client to become ready,
						resumes the OIDC callback, then returns to the stored post-auth
						redirect.
					</p>
				</div>
				{failurePresentation ? (
					<ErrorPresentationCallout
						descriptor={failurePresentation}
						eyebrow="Callback failure"
					/>
				) : null}
				{state.status === ResourceStatus.Loading ||
				state.status === ResourceStatus.Reloading ? (
					<p className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">
						Warming the frontend-mode client registry and resuming the OIDC
						callback...
					</p>
				) : null}
				{state.status === ResourceStatus.Idle ? (
					<p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-300">
						This URL does not currently carry a recognized frontend-mode
						callback payload.
					</p>
				) : null}
			</div>
		</div>
	);
}
