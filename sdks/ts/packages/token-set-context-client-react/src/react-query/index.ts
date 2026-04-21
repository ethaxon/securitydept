// @securitydept/token-set-context-client-react/react-query
//
// Subpath exposing optional React Query integration helpers. This module
// lives under the main React package (per the iteration 110 constraint:
// "no standalone @securitydept/...-react-query package — sub-path +
// devDependencies + optional peerDependencies").
//
// Adopters must install `@tanstack/react-query` themselves — it is declared
// as an optional peer dependency. If the peer is missing, importing this
// subpath resolves fine (we only use its types), but invoking the helpers
// at runtime without a QueryClient will throw.
//
// Stability: provisional (new in iteration 110)

import type {
	CancellationTokenTrait,
	HttpTransport,
} from "@securitydept/client";
import { ClientError, FetchTransportRedirectKind } from "@securitydept/client";
import {
	createCancellationTokenFromAbortSignal,
	createFetchTransport,
} from "@securitydept/client/web";
import type { AuthorizationHeaderProviderTrait } from "@securitydept/token-set-context-client/backend-oidc-mode";
import { createBackendOidcModeAuthorizedTransport } from "@securitydept/token-set-context-client/backend-oidc-mode";
import type {
	QueryClient,
	QueryKey,
	UseMutationResult,
	UseQueryOptions,
	UseQueryResult,
} from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	useTokenSetAccessToken,
	useTokenSetAuthRegistry,
	useTokenSetBackendOidcClient,
} from "../token-set-auth-provider";
import type { TokenSetAuthService } from "../token-set-auth-service";

export const AuthEntryKind = {
	Basic: "basic",
	Token: "token",
} as const;

export type AuthEntryKind = (typeof AuthEntryKind)[keyof typeof AuthEntryKind];

export interface Group {
	id: string;
	name: string;
}

export interface AuthEntry {
	id: string;
	name: string;
	kind: AuthEntryKind;
	username?: string;
	group_ids: string[];
	created_at: string;
	updated_at: string;
}

export interface CreateTokenEntryRequest {
	name: string;
	group_ids: string[];
}

export interface CreateBasicEntryRequest {
	name: string;
	username: string;
	password: string;
	group_ids: string[];
}

export interface CreateGroupRequest {
	name: string;
	entry_ids?: string[];
}

export interface UpdateGroupRequest {
	name: string;
	entry_ids?: string[];
}

export interface UpdateEntryRequest {
	name?: string;
	username?: string;
	password?: string;
	group_ids?: string[];
}

export interface CreateBasicEntryResponse {
	entry: AuthEntry;
}

export interface CreateTokenResponse {
	entry: AuthEntry;
	token: string;
}

export interface TokenSetApiRequestOptions {
	baseUrl?: string;
	transport?: HttpTransport;
	cancellationToken?: CancellationTokenTrait;
	abortSignal?: AbortSignal;
}

export type TokenSetQueryRequestOptions = Omit<
	TokenSetApiRequestOptions,
	"cancellationToken" | "abortSignal"
>;

export type TokenSetMutationRequestOptions = Omit<
	TokenSetApiRequestOptions,
	"abortSignal"
>;

export interface TokenSetScopedHookOptions {
	clientKey: string;
	enabled?: boolean;
	requestOptions?: TokenSetQueryRequestOptions;
}

export interface TokenSetGroupQueryOptions extends TokenSetScopedHookOptions {
	groupId: string;
}

export interface TokenSetEntryQueryOptions extends TokenSetScopedHookOptions {
	entryId: string;
}

export interface TokenSetMutationHookOptions {
	clientKey: string;
	requestOptions?: TokenSetQueryRequestOptions;
}

export type CreateGroupMutationVariables = CreateGroupRequest & {
	requestOptions?: TokenSetMutationRequestOptions;
};

export type UpdateGroupMutationVariables = {
	id: string;
	requestOptions?: TokenSetMutationRequestOptions;
} & UpdateGroupRequest;

export interface DeleteGroupMutationVariables {
	groupId: string;
	requestOptions?: TokenSetMutationRequestOptions;
}

export type CreateBasicEntryMutationVariables = CreateBasicEntryRequest & {
	requestOptions?: TokenSetMutationRequestOptions;
};

export type CreateTokenEntryMutationVariables = CreateTokenEntryRequest & {
	requestOptions?: TokenSetMutationRequestOptions;
};

export type UpdateEntryMutationVariables = {
	id: string;
	requestOptions?: TokenSetMutationRequestOptions;
} & UpdateEntryRequest;

export interface DeleteEntryMutationVariables {
	entryId: string;
	requestOptions?: TokenSetMutationRequestOptions;
}

const tokenSetApiTransport = createFetchTransport({
	redirect: FetchTransportRedirectKind.Follow,
});

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------

/**
 * Namespaced query keys for token-set-aware React Query caches.
 *
 * Adopters should use these as prefixes when caching data that should be
 * invalidated on auth state changes. For example:
 *
 * ```ts
 * useQuery({
 *   queryKey: [...tokenSetQueryKeys.forClient("main"), "profile"],
 *   queryFn: () => fetchProfile(accessToken),
 * });
 * ```
 */
export const tokenSetQueryKeys = {
	all: ["tokenSetContext"] as const,
	forClient: (clientKey: string) =>
		[...tokenSetQueryKeys.all, clientKey] as const,
	readiness: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "readiness"] as const,
	authState: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "authState"] as const,
	groups: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "groups"] as const,
	group: (clientKey: string, groupId: string) =>
		[...tokenSetQueryKeys.groups(clientKey), groupId] as const,
	entries: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "entries"] as const,
	entry: (clientKey: string, entryId: string) =>
		[...tokenSetQueryKeys.entries(clientKey), entryId] as const,
} as const;

// ---------------------------------------------------------------------------
// Readiness query
// ---------------------------------------------------------------------------

/**
 * React Query hook wrapping `registry.whenReady(key)`. Useful for gating
 * a route or suspense boundary on async client materialization (primary
 * async or lazy-preloaded clients).
 *
 * The query resolves with the materialized `TokenSetAuthService` and stays
 * in `"success"` state as long as the client remains registered.
 */
export function useTokenSetReadinessQuery(
	clientKey: string,
	options?: Omit<
		UseQueryOptions<TokenSetAuthService, Error, TokenSetAuthService, QueryKey>,
		"queryKey" | "queryFn"
	>,
): UseQueryResult<TokenSetAuthService, Error> {
	const registry = useTokenSetAuthRegistry();
	return useQuery<TokenSetAuthService, Error, TokenSetAuthService, QueryKey>({
		queryKey: tokenSetQueryKeys.readiness(clientKey),
		queryFn: async () => registry.whenReady(clientKey),
		staleTime: Number.POSITIVE_INFINITY,
		...options,
	});
}

// ---------------------------------------------------------------------------
// Invalidation helper
// ---------------------------------------------------------------------------

/**
 * Imperative helper that invalidates every cached query registered under
 * the token-set namespace for a given client key. Typical usage: wire
 * this into a `signOut()` action so stale user data is re-fetched.
 */
export function invalidateTokenSetQueriesForClient(
	queryClient: QueryClient,
	clientKey: string,
): Promise<void> {
	return queryClient.invalidateQueries({
		queryKey: tokenSetQueryKeys.forClient(clientKey),
	});
}

// ---------------------------------------------------------------------------
// Authorization header convenience
// ---------------------------------------------------------------------------

/**
 * Build a `useQuery` enabled flag + `Authorization` headers tuple for the
 * given client key. Returns `null` when the client is not ready yet so
 * adopters can short-circuit the query.
 */
export function useTokenSetAuthorizationHeader(clientKey: string): {
	enabled: boolean;
	authorization: string | null;
} {
	// This throws if not ready — callers can use useTokenSetReadinessQuery first.
	useTokenSetBackendOidcClient(clientKey);
	const accessToken = useTokenSetAccessToken(clientKey);

	return useMemo(
		() => ({
			enabled: accessToken !== null,
			authorization: accessToken ? `Bearer ${accessToken}` : null,
		}),
		[accessToken],
	);
}

function isQueryEnabled(options: { enabled?: boolean }, authEnabled: boolean) {
	return (options.enabled ?? true) && authEnabled;
}

function resolveCancellationToken(
	options: TokenSetApiRequestOptions,
): CancellationTokenTrait | undefined {
	if (options.cancellationToken) {
		return options.cancellationToken;
	}

	return createCancellationTokenFromAbortSignal(options.abortSignal);
}

function createAuthorizedTokenSetApiTransport(
	client: AuthorizationHeaderProviderTrait,
	options: TokenSetApiRequestOptions,
): HttpTransport {
	return createBackendOidcModeAuthorizedTransport(client, {
		transport: options.transport ?? tokenSetApiTransport,
	});
}

function mergeRequestOptions(
	defaults: TokenSetQueryRequestOptions | undefined,
	overrides: TokenSetApiRequestOptions = {},
): TokenSetApiRequestOptions {
	return {
		...defaults,
		...overrides,
	};
}

async function listGroupsWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	options: TokenSetApiRequestOptions = {},
): Promise<Group[]> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups`,
		method: "GET",
		headers: { accept: "application/json" },
		cancellationToken: resolveCancellationToken(options),
	});

	if (response.status !== 200 || !Array.isArray(response.body)) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as Group[];
}

async function getGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	groupId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<Group> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups/${encodeURIComponent(groupId)}`,
		method: "GET",
		headers: { accept: "application/json" },
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("id" in response.body) ||
		!("name" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as Group;
}

async function createGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	request: CreateGroupRequest,
	options: TokenSetApiRequestOptions = {},
): Promise<Group> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups`,
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("id" in response.body) ||
		!("name" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as Group;
}

async function updateGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	groupId: string,
	request: UpdateGroupRequest,
	options: TokenSetApiRequestOptions = {},
): Promise<Group> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups/${encodeURIComponent(groupId)}`,
		method: "PUT",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("id" in response.body) ||
		!("name" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as Group;
}

async function deleteGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	groupId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<void> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups/${encodeURIComponent(groupId)}`,
		method: "DELETE",
		headers: { accept: "application/json" },
		cancellationToken: resolveCancellationToken(options),
	});

	if (response.status !== 204) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}
}

async function listEntriesWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	options: TokenSetApiRequestOptions = {},
): Promise<AuthEntry[]> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries`,
		method: "GET",
		headers: { accept: "application/json" },
		cancellationToken: resolveCancellationToken(options),
	});

	if (response.status !== 200 || !Array.isArray(response.body)) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as AuthEntry[];
}

async function getEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	entryId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<AuthEntry> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries/${encodeURIComponent(entryId)}`,
		method: "GET",
		headers: { accept: "application/json" },
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("id" in response.body) ||
		!("name" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as AuthEntry;
}

async function createTokenEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	request: CreateTokenEntryRequest,
	options: TokenSetApiRequestOptions = {},
): Promise<CreateTokenResponse> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries/token`,
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("token" in response.body) ||
		!("entry" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as CreateTokenResponse;
}

async function createBasicEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	request: CreateBasicEntryRequest,
	options: TokenSetApiRequestOptions = {},
): Promise<CreateBasicEntryResponse> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries/basic`,
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("entry" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as CreateBasicEntryResponse;
}

async function updateEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	entryId: string,
	request: UpdateEntryRequest,
	options: TokenSetApiRequestOptions = {},
): Promise<AuthEntry> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries/${encodeURIComponent(entryId)}`,
		method: "PUT",
		headers: {
			accept: "application/json",
			"content-type": "application/json",
		},
		body: JSON.stringify(request),
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("id" in response.body) ||
		!("name" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as AuthEntry;
}

async function deleteEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	entryId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<void> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries/${encodeURIComponent(entryId)}`,
		method: "DELETE",
		headers: { accept: "application/json" },
		cancellationToken: resolveCancellationToken(options),
	});

	if (response.status !== 204) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}
}

export function useTokenSetGroupsQuery(options: TokenSetScopedHookOptions) {
	const { enabled } = useTokenSetAuthorizationHeader(options.clientKey);
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useQuery<Group[], Error>({
		queryKey: tokenSetQueryKeys.groups(options.clientKey),
		queryFn: ({ signal }) =>
			listGroupsWithTokenSet(
				client,
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetGroupQuery(options: TokenSetGroupQueryOptions) {
	const { enabled } = useTokenSetAuthorizationHeader(options.clientKey);
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useQuery<Group, Error>({
		queryKey: tokenSetQueryKeys.group(options.clientKey, options.groupId),
		queryFn: ({ signal }) =>
			getGroupWithTokenSet(
				client,
				options.groupId,
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: Boolean(options.groupId) && isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetEntriesQuery(options: TokenSetScopedHookOptions) {
	const { enabled } = useTokenSetAuthorizationHeader(options.clientKey);
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useQuery<AuthEntry[], Error>({
		queryKey: tokenSetQueryKeys.entries(options.clientKey),
		queryFn: ({ signal }) =>
			listEntriesWithTokenSet(
				client,
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetEntryQuery(options: TokenSetEntryQueryOptions) {
	const { enabled } = useTokenSetAuthorizationHeader(options.clientKey);
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useQuery<AuthEntry, Error>({
		queryKey: tokenSetQueryKeys.entry(options.clientKey, options.entryId),
		queryFn: ({ signal }) =>
			getEntryWithTokenSet(
				client,
				options.entryId,
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: Boolean(options.entryId) && isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetCreateGroupMutation(
	options: TokenSetMutationHookOptions,
): UseMutationResult<Group, Error, CreateGroupMutationVariables> {
	const queryClient = useQueryClient();
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useMutation<Group, Error, CreateGroupMutationVariables>({
		mutationFn: ({ requestOptions, ...request }) =>
			createGroupWithTokenSet(
				client,
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.groups(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entries(options.clientKey),
			});
		},
	});
}

export function useTokenSetUpdateGroupMutation(
	options: TokenSetMutationHookOptions,
): UseMutationResult<Group, Error, UpdateGroupMutationVariables> {
	const queryClient = useQueryClient();
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useMutation<Group, Error, UpdateGroupMutationVariables>({
		mutationFn: ({ id, requestOptions, ...request }) =>
			updateGroupWithTokenSet(
				client,
				id,
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.groups(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entries(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.group(options.clientKey, variables.id),
			});
		},
	});
}

export function useTokenSetDeleteGroupMutation(
	options: TokenSetMutationHookOptions,
): UseMutationResult<void, Error, DeleteGroupMutationVariables> {
	const queryClient = useQueryClient();
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useMutation<void, Error, DeleteGroupMutationVariables>({
		mutationFn: ({ groupId, requestOptions }) =>
			deleteGroupWithTokenSet(
				client,
				groupId,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.groups(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entries(options.clientKey),
			});
			await queryClient.removeQueries({
				queryKey: tokenSetQueryKeys.group(options.clientKey, variables.groupId),
			});
		},
	});
}

export function useTokenSetCreateBasicEntryMutation(
	options: TokenSetMutationHookOptions,
): UseMutationResult<
	CreateBasicEntryResponse,
	Error,
	CreateBasicEntryMutationVariables
> {
	const queryClient = useQueryClient();
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useMutation<
		CreateBasicEntryResponse,
		Error,
		CreateBasicEntryMutationVariables
	>({
		mutationFn: ({ requestOptions, ...request }) =>
			createBasicEntryWithTokenSet(
				client,
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entries(options.clientKey),
			});
		},
	});
}

export function useTokenSetCreateTokenEntryMutation(
	options: TokenSetMutationHookOptions,
): UseMutationResult<
	CreateTokenResponse,
	Error,
	CreateTokenEntryMutationVariables
> {
	const queryClient = useQueryClient();
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useMutation<
		CreateTokenResponse,
		Error,
		CreateTokenEntryMutationVariables
	>({
		mutationFn: ({ requestOptions, ...request }) =>
			createTokenEntryWithTokenSet(
				client,
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entries(options.clientKey),
			});
		},
	});
}

export function useTokenSetUpdateEntryMutation(
	options: TokenSetMutationHookOptions,
): UseMutationResult<AuthEntry, Error, UpdateEntryMutationVariables> {
	const queryClient = useQueryClient();
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useMutation<AuthEntry, Error, UpdateEntryMutationVariables>({
		mutationFn: ({ id, requestOptions, ...request }) =>
			updateEntryWithTokenSet(
				client,
				id,
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entries(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entry(options.clientKey, variables.id),
			});
		},
	});
}

export function useTokenSetDeleteEntryMutation(
	options: TokenSetMutationHookOptions,
): UseMutationResult<void, Error, DeleteEntryMutationVariables> {
	const queryClient = useQueryClient();
	const client = useTokenSetBackendOidcClient(options.clientKey);

	return useMutation<void, Error, DeleteEntryMutationVariables>({
		mutationFn: ({ entryId, requestOptions }) =>
			deleteEntryWithTokenSet(
				client,
				entryId,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetQueryKeys.entries(options.clientKey),
			});
			await queryClient.removeQueries({
				queryKey: tokenSetQueryKeys.entry(options.clientKey, variables.entryId),
			});
		},
	});
}
