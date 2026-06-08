import { ENVIRONMENT_TOKEN } from "@securitydept/client";
import { useSecuritydeptContext } from "@securitydept/client-react";
import { relayTokenSetPopupCallbackFromEnvironment } from "@securitydept/token-set-context-client/frontend-oidc-mode";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute(
	"/auth/token-set/frontend-mode/popup-callback",
)({
	component: RouteComponent,
});

function RouteComponent() {
	const environment = useSecuritydeptContext().get(ENVIRONMENT_TOKEN);

	useEffect(() => {
		void relayTokenSetPopupCallbackFromEnvironment(environment);
	}, [environment]);

	return (
		<div className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
			<div className="w-full max-w-md space-y-3 rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
				<p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-400">
					Token Set Frontend Mode Popup
				</p>
				<h1 className="text-2xl font-semibold">Relaying popup callback</h1>
				<p className="text-sm leading-6 text-zinc-500 dark:text-zinc-400">
					This popup route relays the OIDC callback URL back to the opener
					window and then closes itself.
				</p>
			</div>
		</div>
	);
}
