import { FetchTransportRedirectKind } from "@securitydept/client";
import { createSessionStorageStore } from "@securitydept/client/persistence/web";
import { createFetchTransport } from "@securitydept/client/web";
import {
	SessionContextClient,
	type SessionInfo,
} from "@securitydept/session-context-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
	return await sessionClient.fetchUserInfo(sessionTransport);
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

export async function logoutCurrentSession(): Promise<void> {
	await sessionClient.logout(sessionTransport);
	await sessionClient.clearPendingLoginRedirect();
}

interface AuthQueryOptions {
	enabled?: boolean;
}

export function useUserInfo(options: AuthQueryOptions = {}) {
	return useQuery<SessionInfo | null>({
		queryKey: ["auth", "user-info"],
		queryFn: fetchCurrentSession,
		enabled: options.enabled ?? true,
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
