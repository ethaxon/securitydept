// React Query hooks for token-set data access and mutations.
//
// These hooks replace the imperative fetch / cancellation / setState
// pattern previously used in TokenSetPage. They consume the canonical
// @securitydept/token-set-context-client-react/react-query surface
// and the app-local business API functions.

import {
	tokenSetQueryKeys,
	useTokenSetAuthorizationHeader,
} from "@securitydept/token-set-context-client-react/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TOKEN_SET_CLIENT_KEY } from "@/App";
import type {
	AuthEntry,
	CreateBasicEntryResponse,
	CreateTokenResponse,
} from "@/api/entries";
import type { Group } from "@/api/groups";
import {
	type CreateBasicEntryWithTokenSetRequest,
	type CreateGroupWithTokenSetRequest,
	type CreateTokenEntryWithTokenSetRequest,
	createBasicEntryWithTokenSet,
	createGroupWithTokenSet,
	createTokenEntryWithTokenSet,
	deleteEntryWithTokenSet,
	deleteGroupWithTokenSet,
	getEntryWithTokenSet,
	getGroupWithTokenSet,
	listEntriesWithTokenSet,
	listGroupsWithTokenSet,
	type UpdateEntryWithTokenSetRequest,
	type UpdateGroupWithTokenSetRequest,
	updateEntryWithTokenSet,
	updateGroupWithTokenSet,
} from "@/api/tokenSet";
import type { BackendOidcModeReactClient } from "@/lib/tokenSetClient";

// ---------------------------------------------------------------------------
// Query key extensions (app-local, layered on top of SDK namespace)
// ---------------------------------------------------------------------------

/** App-local query keys extending the SDK's tokenSetQueryKeys namespace. */
export const tokenSetAppQueryKeys = {
	groups: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "groups"] as const,
	group: (clientKey: string, groupId: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "groups", groupId] as const,
	entries: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "entries"] as const,
	entry: (clientKey: string, entryId: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "entries", entryId] as const,
};

interface TokenSetDashboardQueryOptions {
	enabled?: boolean;
}

function isQueryEnabled(
	options: TokenSetDashboardQueryOptions,
	authEnabled: boolean,
): boolean {
	return (options.enabled ?? true) && authEnabled;
}

// ---------------------------------------------------------------------------
// Groups query
// ---------------------------------------------------------------------------

/**
 * Fetch the groups list via the token-set bearer.
 *
 * - Enabled only when the auth state has a valid access token.
 * - Uses the SDK's tokenSetQueryKeys namespace so invalidation on
 *   sign-out / clear works automatically via invalidateTokenSetQueriesForClient.
 */

export function useTokenSetGroupsQuery(
	client: BackendOidcModeReactClient,
	options: TokenSetDashboardQueryOptions = {},
) {
	const { enabled } = useTokenSetAuthorizationHeader(TOKEN_SET_CLIENT_KEY);

	return useQuery<Group[], Error>({
		queryKey: tokenSetAppQueryKeys.groups(TOKEN_SET_CLIENT_KEY),
		queryFn: ({ signal }) =>
			listGroupsWithTokenSet(client, { abortSignal: signal }),
		enabled: isQueryEnabled(options, enabled),
		// Don't auto-refetch on window focus — user triggers manually via Load button.
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetGroupQuery(
	client: BackendOidcModeReactClient,
	groupId: string,
	options: TokenSetDashboardQueryOptions = {},
) {
	const { enabled } = useTokenSetAuthorizationHeader(TOKEN_SET_CLIENT_KEY);

	return useQuery<Group, Error>({
		queryKey: tokenSetAppQueryKeys.group(TOKEN_SET_CLIENT_KEY, groupId),
		queryFn: ({ signal }) =>
			getGroupWithTokenSet(client, groupId, { abortSignal: signal }),
		enabled: Boolean(groupId) && isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

// ---------------------------------------------------------------------------
// Entries query
// ---------------------------------------------------------------------------

/**
 * Fetch the entries list via the token-set bearer.
 *
 * Same pattern as useTokenSetGroupsQuery.
 */

export function useTokenSetEntriesQuery(
	client: BackendOidcModeReactClient,
	options: TokenSetDashboardQueryOptions = {},
) {
	const { enabled } = useTokenSetAuthorizationHeader(TOKEN_SET_CLIENT_KEY);

	return useQuery<AuthEntry[], Error>({
		queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
		queryFn: ({ signal }) =>
			listEntriesWithTokenSet(client, { abortSignal: signal }),
		enabled: isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetEntryQuery(
	client: BackendOidcModeReactClient,
	entryId: string,
	options: TokenSetDashboardQueryOptions = {},
) {
	const { enabled } = useTokenSetAuthorizationHeader(TOKEN_SET_CLIENT_KEY);

	return useQuery<AuthEntry, Error>({
		queryKey: tokenSetAppQueryKeys.entry(TOKEN_SET_CLIENT_KEY, entryId),
		queryFn: ({ signal }) =>
			getEntryWithTokenSet(client, entryId, { abortSignal: signal }),
		enabled: Boolean(entryId) && isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

// ---------------------------------------------------------------------------
// Create group mutation
// ---------------------------------------------------------------------------

/**
 * Canonical React Query mutation for creating a group via the token-set bearer.
 *
 * Replaces the imperative handleCreateGroup async function + MutationStatus
 * state + CancellationTokenSourceRef pattern. React Query owns the
 * pending / success / error lifecycle; post-mutation invalidation of
 * both groups and entries caches is handled in onSuccess.
 */
export function useCreateGroupMutation(client: BackendOidcModeReactClient) {
	const queryClient = useQueryClient();

	return useMutation<Group, Error, CreateGroupWithTokenSetRequest>({
		mutationFn: (request) => createGroupWithTokenSet(client, request),
		onSuccess: async () => {
			// Group creation may change entry membership, so invalidate both.
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.groups(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
		},
	});
}

export function useUpdateGroupMutation(client: BackendOidcModeReactClient) {
	const queryClient = useQueryClient();

	return useMutation<
		Group,
		Error,
		{ id: string } & UpdateGroupWithTokenSetRequest
	>({
		mutationFn: ({ id, ...request }) =>
			updateGroupWithTokenSet(client, id, request),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.groups(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.group(
					TOKEN_SET_CLIENT_KEY,
					variables.id,
				),
			});
		},
	});
}

export function useDeleteGroupMutation(client: BackendOidcModeReactClient) {
	const queryClient = useQueryClient();

	return useMutation<void, Error, string>({
		mutationFn: (groupId) => deleteGroupWithTokenSet(client, groupId),
		onSuccess: async (_, groupId) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.groups(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.removeQueries({
				queryKey: tokenSetAppQueryKeys.group(TOKEN_SET_CLIENT_KEY, groupId),
			});
		},
	});
}

export function useCreateBasicEntryMutation(
	client: BackendOidcModeReactClient,
) {
	const queryClient = useQueryClient();

	return useMutation<
		CreateBasicEntryResponse,
		Error,
		CreateBasicEntryWithTokenSetRequest
	>({
		mutationFn: (request) => createBasicEntryWithTokenSet(client, request),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
		},
	});
}

export function useCreateTokenEntryMutation(
	client: BackendOidcModeReactClient,
) {
	const queryClient = useQueryClient();

	return useMutation<
		CreateTokenResponse,
		Error,
		CreateTokenEntryWithTokenSetRequest
	>({
		mutationFn: (request) => createTokenEntryWithTokenSet(client, request),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
		},
	});
}

export function useUpdateEntryMutation(client: BackendOidcModeReactClient) {
	const queryClient = useQueryClient();

	return useMutation<
		AuthEntry,
		Error,
		{ id: string } & UpdateEntryWithTokenSetRequest
	>({
		mutationFn: ({ id, ...request }) =>
			updateEntryWithTokenSet(client, id, request),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entry(
					TOKEN_SET_CLIENT_KEY,
					variables.id,
				),
			});
		},
	});
}

export function useDeleteEntryMutation(client: BackendOidcModeReactClient) {
	const queryClient = useQueryClient();

	return useMutation<void, Error, string>({
		mutationFn: (entryId) => deleteEntryWithTokenSet(client, entryId),
		onSuccess: async (_, entryId) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetAppQueryKeys.entries(TOKEN_SET_CLIENT_KEY),
			});
			await queryClient.removeQueries({
				queryKey: tokenSetAppQueryKeys.entry(TOKEN_SET_CLIENT_KEY, entryId),
			});
		},
	});
}
