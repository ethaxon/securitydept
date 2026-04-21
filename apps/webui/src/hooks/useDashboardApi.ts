import { useSessionContext } from "@securitydept/session-context-client-react";
import type { AuthStateSnapshot } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	type TokenSetBackendOidcClient,
	useTokenSetAuthState,
	useTokenSetBackendOidcClient,
} from "@securitydept/token-set-context-client-react";
import {
	tokenSetQueryKeys,
	useTokenSetCreateBasicEntryMutation,
	useTokenSetCreateGroupMutation,
	useTokenSetCreateTokenEntryMutation,
	useTokenSetDeleteEntryMutation,
	useTokenSetDeleteGroupMutation,
	useTokenSetEntriesQuery,
	useTokenSetEntryQuery,
	useTokenSetGroupQuery,
	useTokenSetGroupsQuery,
	useTokenSetUpdateEntryMutation,
	useTokenSetUpdateGroupMutation,
} from "@securitydept/token-set-context-client-react/react-query";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
	useCreateBasicEntry,
	useCreateTokenEntry,
	useDeleteEntry,
	useEntries,
	useEntry,
	useUpdateEntry,
} from "@/api/entries";
import {
	useCreateGroup,
	useDeleteGroup,
	useGroup,
	useGroups,
	useUpdateGroup,
} from "@/api/groups";
import {
	AuthContextMode,
	clearAuthContextMode,
	isTokenSetAuthContextMode,
	resolveAuthContextMode,
	resolveTokenSetClientKey,
	subscribeAuthContextMode,
} from "@/lib/authContext";
import { projectDashboardUser } from "@/lib/dashboardPrincipal";
import { clearTokenSetBackendModeBrowserState } from "@/lib/tokenSetBackendModeClient";
import { TOKEN_SET_BACKEND_MODE_CLIENT_KEY } from "@/lib/tokenSetConfig";
import { clearTokenSetFrontendModeBrowserState } from "@/lib/tokenSetFrontendModeClient";

interface DashboardNotice {
	title: string;
	description: string;
}

interface DashboardRuntime {
	mode: AuthContextMode;
	tokenSetClientKey: string;
	tokenSetState: AuthStateSnapshot | null;
	tokenSetClient: TokenSetBackendOidcClient;
	tokenSetAuthenticated: boolean;
}

export function useAuthContextMode(): AuthContextMode {
	return useSyncExternalStore(
		subscribeAuthContextMode,
		resolveAuthContextMode,
		() => AuthContextMode.Session,
	);
}

export function useDashboardRuntime(): DashboardRuntime {
	const mode = useAuthContextMode();
	const tokenSetClientKey =
		resolveTokenSetClientKey(mode) ?? TOKEN_SET_BACKEND_MODE_CLIENT_KEY;
	const tokenSetClient = useTokenSetBackendOidcClient(tokenSetClientKey);
	const tokenSetState = useTokenSetAuthState(tokenSetClientKey);

	return {
		mode,
		tokenSetClientKey,
		tokenSetState,
		tokenSetClient,
		tokenSetAuthenticated: Boolean(tokenSetState?.tokens.accessToken),
	};
}

export function useDashboardAccessNotice(): DashboardNotice | null {
	const { mode, tokenSetAuthenticated } = useDashboardRuntime();

	if (isTokenSetAuthContextMode(mode) && !tokenSetAuthenticated) {
		return {
			title: "Token-set bearer authentication is not ready.",
			description:
				"Complete the backend-mode or frontend-mode token-set OIDC flow, then return to the dashboard routes.",
		};
	}

	return null;
}

export function useDashboardGroupsQuery() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useGroups({
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetGroupsQuery({
		clientKey: tokenSetClientKey,
		enabled: isTokenSetAuthContextMode(mode),
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardGroupQuery(groupId: string) {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useGroup(groupId, {
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetGroupQuery({
		clientKey: tokenSetClientKey,
		groupId,
		enabled: isTokenSetAuthContextMode(mode),
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardEntriesQuery() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useEntries({
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetEntriesQuery({
		clientKey: tokenSetClientKey,
		enabled: isTokenSetAuthContextMode(mode),
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardEntryQuery(entryId: string) {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useEntry(entryId, {
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetEntryQuery({
		clientKey: tokenSetClientKey,
		entryId,
		enabled: isTokenSetAuthContextMode(mode),
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardCreateGroupMutation() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useCreateGroup();
	const tokenSetMutation = useTokenSetCreateGroupMutation({
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardUpdateGroupMutation() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useUpdateGroup();
	const tokenSetMutation = useTokenSetUpdateGroupMutation({
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardDeleteGroupMutation() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useDeleteGroup();
	const tokenSetMutation = useTokenSetDeleteGroupMutation({
		clientKey: tokenSetClientKey,
	});

	return useMutation({
		mutationKey: ["dashboard", "groups", "delete", mode],
		mutationFn: async ({ groupId }: { groupId: string }) => {
			if (isTokenSetAuthContextMode(mode)) {
				await tokenSetMutation.mutateAsync({ groupId });
				return;
			}

			await sessionMutation.mutateAsync(groupId);
		},
	});
}

export function useDashboardCreateBasicEntryMutation() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useCreateBasicEntry();
	const tokenSetMutation = useTokenSetCreateBasicEntryMutation({
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardCreateTokenEntryMutation() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useCreateTokenEntry();
	const tokenSetMutation = useTokenSetCreateTokenEntryMutation({
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardUpdateEntryMutation() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useUpdateEntry();
	const tokenSetMutation = useTokenSetUpdateEntryMutation({
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardDeleteEntryMutation() {
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useDeleteEntry();
	const tokenSetMutation = useTokenSetDeleteEntryMutation({
		clientKey: tokenSetClientKey,
	});

	return useMutation({
		mutationKey: ["dashboard", "entries", "delete", mode],
		mutationFn: async ({ entryId }: { entryId: string }) => {
			if (isTokenSetAuthContextMode(mode)) {
				await tokenSetMutation.mutateAsync({ entryId });
				return;
			}

			await sessionMutation.mutateAsync(entryId);
		},
	});
}

export function useDashboardCurrentUser() {
	const { mode, tokenSetClient, tokenSetState } = useDashboardRuntime();
	const { loading: sessionLoading, session } = useSessionContext();

	if (mode === AuthContextMode.Session) {
		if (!session) {
			return { user: null, isLoading: sessionLoading };
		}

		return {
			user: projectDashboardUser({
				principal: session.principal,
				contextLabel: "Session",
			}),
			isLoading: sessionLoading,
		};
	}

	if (isTokenSetAuthContextMode(mode)) {
		const principal = tokenSetState?.metadata.principal;
		return {
			user: principal
				? projectDashboardUser({
						principal,
						contextLabel:
							mode === AuthContextMode.TokenSetBackend
								? "Token Set Backend Mode"
								: "Token Set Frontend Mode",
					})
				: null,
			isLoading: false,
			tokenSetClient,
		};
	}

	return {
		user: projectDashboardUser({
			contextLabel: "Basic",
			fallbackDisplayName: "Basic auth context",
			fallbackSubject: "context.basic-auth",
			showIdentity: false,
		}),
		isLoading: false,
		tokenSetClient,
	};
}

export function useDashboardLogout() {
	const { mode, tokenSetClient, tokenSetClientKey } = useDashboardRuntime();
	const { logout: logoutCurrentSession } = useSessionContext();
	const queryClient = useQueryClient();

	const redirectToLogin = () => {
		clearAuthContextMode();
		window.location.href = "/login";
	};

	const sessionLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "session"],
		mutationFn: logoutCurrentSession,
		onSuccess: () => {
			redirectToLogin();
		},
	});

	const tokenSetLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "token-set"],
		mutationFn: async () => {
			if (mode === AuthContextMode.TokenSetBackend) {
				await clearTokenSetBackendModeBrowserState(tokenSetClient);
				return;
			}

			await clearTokenSetFrontendModeBrowserState();
		},
		onSuccess: async () => {
			await queryClient.resetQueries({
				queryKey: tokenSetQueryKeys.forClient(tokenSetClientKey),
			});
			redirectToLogin();
		},
	});

	const basicLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "basic"],
		mutationFn: async () => undefined,
		onSuccess: redirectToLogin,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetLogoutMutation;
	}

	if (mode === AuthContextMode.Basic) {
		return basicLogoutMutation;
	}

	return sessionLogoutMutation;
}
