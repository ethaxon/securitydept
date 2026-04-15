import { resetBackendOidcModeBrowserState } from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import {
	useTokenSetAuthService,
	useTokenSetAuthState,
} from "@securitydept/token-set-context-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { TOKEN_SET_CLIENT_KEY } from "@/App";
import { logoutCurrentSession, useUserInfo } from "@/api/auth";
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
	resolveAuthContextMode,
	subscribeAuthContextMode,
} from "@/lib/authContext";
import type { BackendOidcModeReactClient } from "@/lib/tokenSetClient";
import {
	tokenSetAppQueryKeys,
	useCreateBasicEntryMutation,
	useCreateGroupMutation,
	useCreateTokenEntryMutation,
	useDeleteEntryMutation,
	useDeleteGroupMutation,
	useTokenSetEntriesQuery,
	useTokenSetEntryQuery,
	useTokenSetGroupQuery,
	useTokenSetGroupsQuery,
	useUpdateEntryMutation,
	useUpdateGroupMutation,
} from "./useTokenSetQueries";

interface DashboardNotice {
	title: string;
	description: string;
}

interface DashboardUser {
	displayName: string;
	picture?: string;
	contextLabel: string;
}

export function useAuthContextMode(): AuthContextMode {
	return useSyncExternalStore(
		subscribeAuthContextMode,
		resolveAuthContextMode,
		() => AuthContextMode.Session,
	);
}

export function useDashboardRuntime() {
	const mode = useAuthContextMode();
	const service = useTokenSetAuthService(TOKEN_SET_CLIENT_KEY);
	const tokenSetState = useTokenSetAuthState(TOKEN_SET_CLIENT_KEY);

	return {
		mode,
		tokenSetState,
		tokenSetClient: service.client as BackendOidcModeReactClient,
		tokenSetAuthenticated: Boolean(tokenSetState?.tokens.accessToken),
	};
}

export function useDashboardAccessNotice(): DashboardNotice | null {
	const { mode, tokenSetAuthenticated } = useDashboardRuntime();

	if (mode === AuthContextMode.TokenSet && !tokenSetAuthenticated) {
		return {
			title: "Token Set authentication is not ready.",
			description:
				"Complete the token-set OIDC flow on the Token Set page, then return to the dashboard routes.",
		};
	}

	return null;
}

export function useDashboardGroupsQuery() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionQuery = useGroups({
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetGroupsQuery(tokenSetClient, {
		enabled: mode === AuthContextMode.TokenSet,
	});

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardGroupQuery(groupId: string) {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionQuery = useGroup(groupId, {
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetGroupQuery(tokenSetClient, groupId, {
		enabled: mode === AuthContextMode.TokenSet,
	});

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardEntriesQuery() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionQuery = useEntries({
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetEntriesQuery(tokenSetClient, {
		enabled: mode === AuthContextMode.TokenSet,
	});

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardEntryQuery(entryId: string) {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionQuery = useEntry(entryId, {
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetEntryQuery(tokenSetClient, entryId, {
		enabled: mode === AuthContextMode.TokenSet,
	});

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardCreateGroupMutation() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionMutation = useCreateGroup();
	const tokenSetMutation = useCreateGroupMutation(tokenSetClient);

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardUpdateGroupMutation() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionMutation = useUpdateGroup();
	const tokenSetMutation = useUpdateGroupMutation(tokenSetClient);

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardDeleteGroupMutation() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionMutation = useDeleteGroup();
	const tokenSetMutation = useDeleteGroupMutation(tokenSetClient);

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardCreateBasicEntryMutation() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionMutation = useCreateBasicEntry();
	const tokenSetMutation = useCreateBasicEntryMutation(tokenSetClient);

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardCreateTokenEntryMutation() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionMutation = useCreateTokenEntry();
	const tokenSetMutation = useCreateTokenEntryMutation(tokenSetClient);

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardUpdateEntryMutation() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionMutation = useUpdateEntry();
	const tokenSetMutation = useUpdateEntryMutation(tokenSetClient);

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardDeleteEntryMutation() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const sessionMutation = useDeleteEntry();
	const tokenSetMutation = useDeleteEntryMutation(tokenSetClient);

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardCurrentUser() {
	const { mode, tokenSetClient, tokenSetState } = useDashboardRuntime();
	const sessionQuery = useUserInfo({
		enabled: mode === AuthContextMode.Session,
	});

	if (mode === AuthContextMode.Session) {
		if (!sessionQuery.data) {
			return { user: null, isLoading: sessionQuery.isLoading };
		}

		return {
			user: {
				displayName: sessionQuery.data.principal.displayName,
				picture: sessionQuery.data.principal.picture,
				contextLabel: "Session",
			} satisfies DashboardUser,
			isLoading: sessionQuery.isLoading,
		};
	}

	if (mode === AuthContextMode.TokenSet) {
		const principal = tokenSetState?.metadata.principal;
		return {
			user: principal
				? ({
						displayName: principal.displayName ?? principal.subject ?? "User",
						picture: principal.picture,
						contextLabel: "Token Set",
					} satisfies DashboardUser)
				: null,
			isLoading: false,
			tokenSetClient,
		};
	}

	return {
		user: {
			displayName: "Basic auth context",
			contextLabel: "Basic",
		} satisfies DashboardUser,
		isLoading: false,
		tokenSetClient,
	};
}

export function useDashboardLogout() {
	const { mode, tokenSetClient } = useDashboardRuntime();
	const queryClient = useQueryClient();

	const redirectToLogin = () => {
		clearAuthContextMode();
		window.location.href = "/login";
	};

	const sessionLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "session"],
		mutationFn: logoutCurrentSession,
		onSuccess: async () => {
			await queryClient.removeQueries({ queryKey: ["auth"] });
			redirectToLogin();
		},
	});

	const tokenSetLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "token-set"],
		mutationFn: async () => {
			await resetBackendOidcModeBrowserState(tokenSetClient);
		},
		onSuccess: async () => {
			await queryClient.resetQueries({
				queryKey: tokenSetAppQueryKeys.groups(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.resetQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
			redirectToLogin();
		},
	});

	const basicLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "basic"],
		mutationFn: async () => undefined,
		onSuccess: redirectToLogin,
	});

	if (mode === AuthContextMode.TokenSet) {
		return tokenSetLogoutMutation;
	}

	if (mode === AuthContextMode.Basic) {
		return basicLogoutMutation;
	}

	return sessionLogoutMutation;
}
