import { FetchTransportRedirectKind } from "@securitydept/client";
import { createSessionStorageStore } from "@securitydept/client/persistence/web";
import { createFetchTransport } from "@securitydept/client/web";
import {
	SessionContextClient,
	type SessionInfo,
} from "@securitydept/session-context-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

const sessionClient = new SessionContextClient(
	{ baseUrl: "" },
	{
		sessionStore: createSessionStorageStore("securitydept.webui.auth:"),
	},
);
const sessionTransport = createFetchTransport({
	redirect: FetchTransportRedirectKind.Follow,
});

export async function fetchCurrentSession(): Promise<SessionInfo | null> {
	return await sessionClient.fetchMe(sessionTransport);
}

export async function rememberPostAuthRedirect(
	postAuthRedirectUri: string,
): Promise<void> {
	await sessionClient.savePendingLoginRedirect(postAuthRedirectUri);
}

export async function clearPostAuthRedirect(): Promise<void> {
	await sessionClient.clearPendingLoginRedirect();
}

export async function resolveLoginUrl(): Promise<string> {
	const pendingRedirect = await sessionClient.consumePendingLoginRedirect();
	return sessionClient.loginUrl(pendingRedirect ?? undefined);
}

export async function requireAuthenticatedRoute(
	postAuthRedirectUri: string,
): Promise<SessionInfo> {
	const session = await fetchCurrentSession();
	if (!session) {
		await rememberPostAuthRedirect(postAuthRedirectUri);
		throw redirect({ to: "/login" });
	}

	await clearPostAuthRedirect();
	return session;
}

export async function logoutCurrentSession(): Promise<void> {
	await sessionClient.logout(sessionTransport);
	await sessionClient.clearPendingLoginRedirect();
}

export function useMe() {
	return useQuery<SessionInfo | null>({
		queryKey: ["auth", "me"],
		queryFn: fetchCurrentSession,
		retry: false,
	});
}

export function useLogout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: logoutCurrentSession,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["auth"] });
			window.location.href = "/login";
		},
	});
}
