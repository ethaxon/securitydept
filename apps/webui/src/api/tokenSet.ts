import {
	abortSignalToCancellationToken,
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	createBaseTransportForStdFetch,
	createReplaySignal,
	type ExternalTransportTrait,
	FetchTransportRedirectKind,
	type SecuritydeptInjectorTrait,
} from "@securitydept/client";
import { useReplaySignalValue } from "@securitydept/client-react";
import {
	type AuthorizationHeaderProviderTrait,
	BackendOidcModeContextSource,
	createBackendOidcModeAuthorizedTransportFromBase,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	type ReactRegistry,
	TOKEN_SET_AUTH_REGISTRY,
	type TokenSetReactClient,
} from "@securitydept/token-set-context-client-react";
import { tokenSetQueryKeys } from "@securitydept/token-set-context-client-react/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useSyncExternalStore } from "react";
import {
	type AuthEntry,
	type CreateBasicEntryResponse,
	type CreateTokenResponse,
} from "./entries";
import { type Group } from "./groups";

const tokenSetApiTransport = createBaseTransportForStdFetch({
	redirect: FetchTransportRedirectKind.Follow,
});
const emptyAuthorizationHeaderSignal = createReplaySignal<string | undefined>();

export const DEFAULT_PROPAGATION_HEADER_NAME = "x-securitydept-propagation";
export const DEFAULT_PROPAGATION_PROBE_PATH = "/api/propagation/api/health";
export const DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET = `[token_set_context.token_propagation]
default_policy = "validate_then_forward"

[token_set_context.token_propagation.destination_policy]
allowed_targets = [
  { kind = "exact_origin", scheme = "http", hostname = "localhost", port = 7021 },
]

[propagation_forwarder]
proxy_path = "/api/propagation"`;

export interface TokenSetApiRequestOptions {
	baseUrl?: string;
	transport?: ExternalTransportTrait;
	cancellationToken?: CancellationTokenTrait;
	/** Web AbortSignal — bridged to CancellationTokenTrait for React Query compatibility. */
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
	injector?: SecuritydeptInjectorTrait;
	registry?: ReactRegistry;
	client?: TokenSetReactClient;
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
	injector?: SecuritydeptInjectorTrait;
	registry?: ReactRegistry;
	client?: TokenSetReactClient;
	requestOptions?: TokenSetQueryRequestOptions;
}

export const tokenSetDashboardQueryKeys = {
	forClient: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "dashboard"] as const,
	groups: (clientKey: string) =>
		[...tokenSetDashboardQueryKeys.forClient(clientKey), "groups"] as const,
	group: (clientKey: string, groupId: string) =>
		[...tokenSetDashboardQueryKeys.groups(clientKey), groupId] as const,
	entries: (clientKey: string) =>
		[...tokenSetDashboardQueryKeys.forClient(clientKey), "entries"] as const,
	entry: (clientKey: string, entryId: string) =>
		[...tokenSetDashboardQueryKeys.entries(clientKey), entryId] as const,
} as const;

export interface ForwardAuthBoundaryProbeResult {
	status: number;
	authenticated: boolean;
	authorizationChallenge: string | null;
	authenticatedEntry: string | null;
}

export interface CreateTokenEntryWithTokenSetRequest {
	name: string;
	group_ids: string[];
}

export interface CreateBasicEntryWithTokenSetRequest {
	name: string;
	username: string;
	password: string;
	group_ids: string[];
}

export interface CreateGroupWithTokenSetRequest {
	name: string;
	entry_ids?: string[];
}

export interface UpdateGroupWithTokenSetRequest {
	name: string;
	entry_ids?: string[];
}

export interface UpdateEntryWithTokenSetRequest {
	name?: string;
	username?: string;
	password?: string;
	group_ids?: string[];
}

export interface PropagationProbeResult {
	status: number;
	body: unknown;
}

export interface PropagationProbeAssessment {
	summary: string;
	configStatus: string | null;
	recommendedConfigSnippet: string | null;
}

function encodeBasicAuthorization(username: string, password: string): string {
	const value = `${username}:${password}`;
	if (typeof globalThis.btoa === "function") {
		return `Basic ${globalThis.btoa(value)}`;
	}
	const runtime = globalThis as typeof globalThis & {
		Buffer?: {
			from(
				input: string,
				encoding: string,
			): { toString(encoding: string): string };
		};
	};
	if (runtime.Buffer) {
		return `Basic ${runtime.Buffer.from(value, "utf8").toString("base64")}`;
	}
	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		message: "Basic authorization encoding is unavailable in this runtime",
		code: "basic_auth.encoding.unavailable",
		source: BackendOidcModeContextSource.Client,
	});
}

function createAuthorizedTokenSetApiTransport(
	client: AuthorizationHeaderProviderTrait,
	options: TokenSetApiRequestOptions,
): ExternalTransportTrait {
	return createBackendOidcModeAuthorizedTransportFromBase(client, {
		baseTransport: options.transport ?? tokenSetApiTransport,
	});
}

function resolveCancellationToken(
	options: TokenSetApiRequestOptions,
): CancellationTokenTrait | undefined {
	if (options.cancellationToken) return options.cancellationToken;
	return abortSignalToCancellationToken(options.abortSignal);
}

function resolveTokenSetRegistry(options: {
	clientKey: string;
	injector?: SecuritydeptInjectorTrait;
	registry?: ReactRegistry;
}): ReactRegistry {
	if (options.registry) {
		return options.registry;
	}

	if (options.injector) {
		return options.injector.get(TOKEN_SET_AUTH_REGISTRY);
	}

	throw new Error(
		`[webui token-set api] ${options.clientKey} requires an explicit registry or injector.`,
	);
}

async function resolveTokenSetClient(options: {
	clientKey: string;
	injector?: SecuritydeptInjectorTrait;
	registry?: ReactRegistry;
	client?: TokenSetReactClient;
}): Promise<TokenSetReactClient> {
	if (options.client) {
		return options.client;
	}

	return resolveTokenSetRegistry(options).whenReady(options.clientKey);
}

function useResolvedTokenSetClient(options: {
	clientKey: string;
	injector?: SecuritydeptInjectorTrait;
	registry?: ReactRegistry;
	client?: TokenSetReactClient;
}): { enabled: boolean; client: TokenSetReactClient | undefined } {
	const directClientSignal = useMemo(() => {
		const signal = createReplaySignal<TokenSetReactClient>();
		if (options.client) {
			signal.setValue(options.client);
		}
		return signal;
	}, [options.client]);
	const clientSource = options.client
		? directClientSignal
		: resolveTokenSetRegistry(options).clientSignalFor(options.clientKey);
	const clientSlot = useSyncExternalStore(
		(listener) => clientSource.subscribe(listener),
		() => clientSource.get(),
		() => clientSource.get(),
	);
	const client =
		options.client ??
		(clientSlot.kind === "value" ? clientSlot.value : undefined);
	const authorizationHeader = useReplaySignalValue(
		client?.authorizationHeaderValue ?? emptyAuthorizationHeaderSignal,
		{ initialValue: undefined },
	);
	return {
		enabled: client !== undefined && authorizationHeader !== undefined,
		client,
	};
}

function requireTokenSetClient(
	client: TokenSetReactClient | undefined,
	clientKey: string,
): TokenSetReactClient {
	if (client) return client;
	throw new Error(
		`[webui token-set api] ${clientKey} is not ready. Query execution should be disabled until clientSignalFor() emits.`,
	);
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

function isQueryEnabled(options: { enabled?: boolean }, authEnabled: boolean) {
	return (options.enabled ?? true) && authEnabled;
}

export function useTokenSetGroupsQuery(options: TokenSetScopedHookOptions) {
	const { enabled, client } = useResolvedTokenSetClient(options);

	return useQuery({
		queryKey: tokenSetDashboardQueryKeys.groups(options.clientKey),
		queryFn: ({ signal }) =>
			listGroupsWithTokenSet(
				requireTokenSetClient(client, options.clientKey),
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetGroupQuery(options: TokenSetGroupQueryOptions) {
	const { enabled, client } = useResolvedTokenSetClient(options);

	return useQuery({
		queryKey: tokenSetDashboardQueryKeys.group(
			options.clientKey,
			options.groupId,
		),
		queryFn: ({ signal }) =>
			getGroupWithTokenSet(
				requireTokenSetClient(client, options.clientKey),
				options.groupId,
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: Boolean(options.groupId) && isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetEntriesQuery(options: TokenSetScopedHookOptions) {
	const { enabled, client } = useResolvedTokenSetClient(options);

	return useQuery({
		queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
		queryFn: ({ signal }) =>
			listEntriesWithTokenSet(
				requireTokenSetClient(client, options.clientKey),
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetEntryQuery(options: TokenSetEntryQueryOptions) {
	const { enabled, client } = useResolvedTokenSetClient(options);

	return useQuery({
		queryKey: tokenSetDashboardQueryKeys.entry(
			options.clientKey,
			options.entryId,
		),
		queryFn: ({ signal }) =>
			getEntryWithTokenSet(
				requireTokenSetClient(client, options.clientKey),
				options.entryId,
				mergeRequestOptions(options.requestOptions, { abortSignal: signal }),
			),
		enabled: Boolean(options.entryId) && isQueryEnabled(options, enabled),
		refetchOnWindowFocus: false,
	});
}

export function useTokenSetCreateGroupMutation(
	options: TokenSetMutationHookOptions,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			requestOptions,
			...request
		}: CreateGroupWithTokenSetRequest & {
			requestOptions?: TokenSetMutationRequestOptions;
		}) =>
			createGroupWithTokenSet(
				await resolveTokenSetClient(options),
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.groups(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
			});
		},
	});
}

export function useTokenSetUpdateGroupMutation(
	options: TokenSetMutationHookOptions,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			id,
			requestOptions,
			...request
		}: UpdateGroupWithTokenSetRequest & {
			id: string;
			requestOptions?: TokenSetMutationRequestOptions;
		}) =>
			updateGroupWithTokenSet(
				await resolveTokenSetClient(options),
				id,
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.groups(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.group(
					options.clientKey,
					variables.id,
				),
			});
		},
	});
}

export function useTokenSetDeleteGroupMutation(
	options: TokenSetMutationHookOptions,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			groupId,
			requestOptions,
		}: {
			groupId: string;
			requestOptions?: TokenSetMutationRequestOptions;
		}) =>
			deleteGroupWithTokenSet(
				await resolveTokenSetClient(options),
				groupId,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.groups(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
			});
			await queryClient.removeQueries({
				queryKey: tokenSetDashboardQueryKeys.group(
					options.clientKey,
					variables.groupId,
				),
			});
		},
	});
}

export function useTokenSetCreateBasicEntryMutation(
	options: TokenSetMutationHookOptions,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			requestOptions,
			...request
		}: CreateBasicEntryWithTokenSetRequest & {
			requestOptions?: TokenSetMutationRequestOptions;
		}) =>
			createBasicEntryWithTokenSet(
				await resolveTokenSetClient(options),
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
			});
		},
	});
}

export function useTokenSetCreateTokenEntryMutation(
	options: TokenSetMutationHookOptions,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			requestOptions,
			...request
		}: CreateTokenEntryWithTokenSetRequest & {
			requestOptions?: TokenSetMutationRequestOptions;
		}) =>
			createTokenEntryWithTokenSet(
				await resolveTokenSetClient(options),
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
			});
		},
	});
}

export function useTokenSetUpdateEntryMutation(
	options: TokenSetMutationHookOptions,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			id,
			requestOptions,
			...request
		}: UpdateEntryWithTokenSetRequest & {
			id: string;
			requestOptions?: TokenSetMutationRequestOptions;
		}) =>
			updateEntryWithTokenSet(
				await resolveTokenSetClient(options),
				id,
				request,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
			});
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entry(
					options.clientKey,
					variables.id,
				),
			});
		},
	});
}

export function useTokenSetDeleteEntryMutation(
	options: TokenSetMutationHookOptions,
) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async ({
			entryId,
			requestOptions,
		}: {
			entryId: string;
			requestOptions?: TokenSetMutationRequestOptions;
		}) =>
			deleteEntryWithTokenSet(
				await resolveTokenSetClient(options),
				entryId,
				mergeRequestOptions(options.requestOptions, requestOptions),
			),
		onSuccess: async (_, variables) => {
			await queryClient.invalidateQueries({
				queryKey: tokenSetDashboardQueryKeys.entries(options.clientKey),
			});
			await queryClient.removeQueries({
				queryKey: tokenSetDashboardQueryKeys.entry(
					options.clientKey,
					variables.entryId,
				),
			});
		},
	});
}

export async function listGroupsWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	options: TokenSetApiRequestOptions = {},
): Promise<Group[]> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups`,
		method: "GET",
		headers: {
			accept: "application/json",
		},
		cancellationToken: resolveCancellationToken(options),
	});

	if (response.status !== 200 || !Array.isArray(response.body)) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as Group[];
}

export async function listEntriesWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	options: TokenSetApiRequestOptions = {},
): Promise<AuthEntry[]> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries`,
		method: "GET",
		headers: {
			accept: "application/json",
		},
		cancellationToken: resolveCancellationToken(options),
	});

	if (response.status !== 200 || !Array.isArray(response.body)) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return response.body as AuthEntry[];
}

export async function createTokenEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	request: CreateTokenEntryWithTokenSetRequest,
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

export async function createBasicEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	request: CreateBasicEntryWithTokenSetRequest,
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

export async function createGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	request: CreateGroupWithTokenSetRequest,
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

export async function getGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	groupId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<Group> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups/${encodeURIComponent(groupId)}`,
		method: "GET",
		headers: {
			accept: "application/json",
		},
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

export async function updateGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	groupId: string,
	request: UpdateGroupWithTokenSetRequest,
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

export async function deleteGroupWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	groupId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<void> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/groups/${encodeURIComponent(groupId)}`,
		method: "DELETE",
		headers: {
			accept: "application/json",
		},
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("ok" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}
}

export async function getEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	entryId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<AuthEntry> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries/${encodeURIComponent(entryId)}`,
		method: "GET",
		headers: {
			accept: "application/json",
		},
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

export async function updateEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	entryId: string,
	request: UpdateEntryWithTokenSetRequest,
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

export async function deleteEntryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	entryId: string,
	options: TokenSetApiRequestOptions = {},
): Promise<void> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/entries/${encodeURIComponent(entryId)}`,
		method: "DELETE",
		headers: {
			accept: "application/json",
		},
		cancellationToken: resolveCancellationToken(options),
	});

	if (
		response.status !== 200 ||
		!response.body ||
		typeof response.body !== "object" ||
		!("ok" in response.body)
	) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}
}

export async function probeForwardAuthBoundaryWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	groupName: string,
	options: TokenSetApiRequestOptions = {},
): Promise<ForwardAuthBoundaryProbeResult> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/forwardauth/traefik/${encodeURIComponent(groupName)}`,
		method: "GET",
		headers: {
			accept: "application/json",
		},
		cancellationToken: options.cancellationToken,
	});

	if (response.status !== 200 && response.status !== 401) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return {
		status: response.status,
		authenticated: response.status === 200,
		authorizationChallenge:
			response.headers["www-authenticate"] ??
			response.headers["WWW-Authenticate"] ??
			null,
		authenticatedEntry:
			response.headers["x-auth-user"] ??
			response.headers["X-Auth-User"] ??
			null,
	};
}

export async function probeForwardAuthWithEntryToken(
	entryToken: string,
	groupName: string,
	options: TokenSetApiRequestOptions = {},
): Promise<ForwardAuthBoundaryProbeResult> {
	const transport = options.transport ?? tokenSetApiTransport;
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/forwardauth/traefik/${encodeURIComponent(groupName)}`,
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: `Bearer ${entryToken}`,
		},
		cancellationToken: options.cancellationToken,
	});

	if (response.status !== 200 && response.status !== 401) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return {
		status: response.status,
		authenticated: response.status === 200,
		authorizationChallenge:
			response.headers["www-authenticate"] ??
			response.headers["WWW-Authenticate"] ??
			null,
		authenticatedEntry:
			response.headers["x-auth-user"] ??
			response.headers["X-Auth-User"] ??
			null,
	};
}

export async function probeForwardAuthWithBasicEntry(
	username: string,
	password: string,
	groupName: string,
	options: TokenSetApiRequestOptions = {},
): Promise<ForwardAuthBoundaryProbeResult> {
	const transport = options.transport ?? tokenSetApiTransport;
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}/api/forwardauth/traefik/${encodeURIComponent(groupName)}`,
		method: "GET",
		headers: {
			accept: "application/json",
			authorization: encodeBasicAuthorization(username, password),
		},
		cancellationToken: options.cancellationToken,
	});

	if (response.status !== 200 && response.status !== 401) {
		throw ClientError.fromHttpResponse(response.status, response.body);
	}

	return {
		status: response.status,
		authenticated: response.status === 200,
		authorizationChallenge:
			response.headers["www-authenticate"] ??
			response.headers["WWW-Authenticate"] ??
			null,
		authenticatedEntry:
			response.headers["x-auth-user"] ??
			response.headers["X-Auth-User"] ??
			null,
	};
}

export async function probePropagationRouteWithTokenSet(
	client: AuthorizationHeaderProviderTrait,
	directive: string,
	options: TokenSetApiRequestOptions & { path?: string } = {},
): Promise<PropagationProbeResult> {
	const transport = createAuthorizedTokenSetApiTransport(client, options);
	const response = await transport.execute({
		url: `${options.baseUrl ?? ""}${options.path ?? DEFAULT_PROPAGATION_PROBE_PATH}`,
		method: "GET",
		headers: {
			accept: "application/json",
			[DEFAULT_PROPAGATION_HEADER_NAME]: directive,
		},
		cancellationToken: options.cancellationToken,
	});

	return {
		status: response.status,
		body: response.body,
	};
}

export function assessPropagationProbeResult(
	status: number,
	body: unknown,
): PropagationProbeAssessment {
	if (status >= 200 && status < 300) {
		return {
			summary:
				"Propagation route is mounted and successfully forwarded the dashboard bearer to the configured downstream target.",
			configStatus:
				"The current config is sufficient for the same-server healthcheck path. Keep this probe in app space because the route path, target origin, and policy remain product-specific.",
			recommendedConfigSnippet: null,
		};
	}

	if (status === 404) {
		return {
			summary:
				"The current environment does not expose `/api/propagation/*`, so the dashboard bearer and propagation directive reached a valid route shape but no mounted forwarder.",
			configStatus:
				"The checked-in server config currently omits a usable propagation-forwarder setup. Mount `[propagation_forwarder]` and allow the downstream origin under `[token_set_context.token_propagation.destination_policy]` before expecting real forwarding behavior.",
			recommendedConfigSnippet: DEFAULT_PROPAGATION_FORWARDER_CONFIG_SNIPPET,
		};
	}

	if (body && typeof body === "object") {
		const payload = body as {
			error?: {
				code?: string;
				message?: string;
				recovery?: string;
			};
			message?: string;
			status?: number;
		};
		const message = payload.error?.message ?? payload.message;
		if (message) {
			return {
				summary: `Propagation route returned HTTP ${status}: ${message}`,
				configStatus:
					"The route is mounted, so the remaining issue is propagation policy, directive validity, or downstream reachability rather than bearer/header wiring.",
				recommendedConfigSnippet: null,
			};
		}
	}

	return {
		summary: `Propagation route returned HTTP ${status}.`,
		configStatus:
			status >= 400
				? "The route is mounted, so the remaining issue is server-side propagation policy or downstream routing."
				: "The route is mounted and accepted the request shape from the dashboard bearer.",
		recommendedConfigSnippet: null,
	};
}
