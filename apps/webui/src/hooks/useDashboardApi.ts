import type {
	ReadableSignalTrait,
	ReplaySignalSlot,
} from "@securitydept/client";
import {
	useReadableSignal,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { SESSION_CONTEXT_CONTROLLER } from "@securitydept/session-context-client-react";
import type { AuthStateSnapshot } from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	TOKEN_SET_AUTH_REGISTRY,
	type TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import { tokenSetQueryKeys } from "@securitydept/token-set-context-client-react/react-query";
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
} from "@/api/tokenSet";
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
import { assertTokenSetBackendOidcClient } from "@/lib/tokenSetClientAssertions";
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
	tokenSetClient: TokenSetReactClient | null;
	tokenSetAuthenticated: boolean;
}

const EMPTY_TOKEN_SET_AUTH_SNAPSHOT_SIGNAL: ReadableSignalTrait<
	ReplaySignalSlot<AuthStateSnapshot | null>
> = {
	get: () => ({ kind: "value", value: null }),
	subscribe: () => () => {},
};

function useDashboardSessionController() {
	return useSecuritydeptContext().get(SESSION_CONTEXT_CONTROLLER);
}

function useDashboardSessionState() {
	const controller = useDashboardSessionController();
	const state = useReadableSignal(controller.state);

	return { controller, state };
}

function useDashboardTokenSetClient(
	clientKey: string,
): TokenSetReactClient | null {
	const registry = useSecuritydeptContext().get(TOKEN_SET_AUTH_REGISTRY);
	const slot = useReadableSignal(registry.clientSignalFor(clientKey));
	return slot.kind === "value" ? slot.value : null;
}

function useDashboardTokenSetSnapshot(
	client: TokenSetReactClient | null,
): AuthStateSnapshot | null {
	const slot = useReadableSignal(
		client?.authSnapshot ?? EMPTY_TOKEN_SET_AUTH_SNAPSHOT_SIGNAL,
	);
	return slot.kind === "value"
		? (slot.value as AuthStateSnapshot | null)
		: null;
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
	const tokenSetClient = useDashboardTokenSetClient(tokenSetClientKey);
	const tokenSetState = useDashboardTokenSetSnapshot(tokenSetClient);

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
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useGroups({
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetGroupsQuery({
		injector,
		clientKey: tokenSetClientKey,
		enabled: isTokenSetAuthContextMode(mode),
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardGroupQuery(groupId: string) {
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useGroup(groupId, {
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetGroupQuery({
		injector,
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
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useEntries({
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetEntriesQuery({
		injector,
		clientKey: tokenSetClientKey,
		enabled: isTokenSetAuthContextMode(mode),
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetQuery;
	}

	return sessionQuery;
}

export function useDashboardEntryQuery(entryId: string) {
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionQuery = useEntry(entryId, {
		enabled: mode === AuthContextMode.Session || mode === AuthContextMode.Basic,
	});
	const tokenSetQuery = useTokenSetEntryQuery({
		injector,
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
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useCreateGroup();
	const tokenSetMutation = useTokenSetCreateGroupMutation({
		injector,
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardUpdateGroupMutation() {
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useUpdateGroup();
	const tokenSetMutation = useTokenSetUpdateGroupMutation({
		injector,
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardDeleteGroupMutation() {
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useDeleteGroup();
	const tokenSetMutation = useTokenSetDeleteGroupMutation({
		injector,
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
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useCreateBasicEntry();
	const tokenSetMutation = useTokenSetCreateBasicEntryMutation({
		injector,
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardCreateTokenEntryMutation() {
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useCreateTokenEntry();
	const tokenSetMutation = useTokenSetCreateTokenEntryMutation({
		injector,
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardUpdateEntryMutation() {
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useUpdateEntry();
	const tokenSetMutation = useTokenSetUpdateEntryMutation({
		injector,
		clientKey: tokenSetClientKey,
	});

	if (isTokenSetAuthContextMode(mode)) {
		return tokenSetMutation;
	}

	return sessionMutation;
}

export function useDashboardDeleteEntryMutation() {
	const injector = useSecuritydeptContext();
	const { mode, tokenSetClientKey } = useDashboardRuntime();
	const sessionMutation = useDeleteEntry();
	const tokenSetMutation = useTokenSetDeleteEntryMutation({
		injector,
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
	const { state: sessionState } = useDashboardSessionState();
	const sessionLoading = sessionState.status === "loading";
	const session = sessionState.session;

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
	const { controller: sessionController } = useDashboardSessionState();
	const queryClient = useQueryClient();

	const redirectToLogin = () => {
		clearAuthContextMode();
		window.location.href = "/login";
	};

	const sessionLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "session"],
		mutationFn: () => sessionController.logout(),
		onSuccess: () => {
			redirectToLogin();
		},
	});

	const tokenSetLogoutMutation = useMutation({
		mutationKey: ["dashboard", "logout", "token-set"],
		mutationFn: async () => {
			if (mode === AuthContextMode.TokenSetBackend) {
				if (!tokenSetClient) {
					throw new Error("Backend token-set logout requires a ready client.");
				}
				assertTokenSetBackendOidcClient(
					tokenSetClient,
					"Backend token-set logout",
				);

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
