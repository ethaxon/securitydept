import type {
	CancellationTokenTrait,
	HttpTransport,
} from "@securitydept/client";
import {
	ClientError,
	ClientErrorKind,
	FetchTransportRedirectKind,
} from "@securitydept/client";
import { createFetchTransport } from "@securitydept/client/web";
import type { AuthorizationHeaderProviderTrait } from "@securitydept/token-set-context-client";
import {
	createTokenSetAuthorizedTransport,
	TokenSetContextSource,
} from "@securitydept/token-set-context-client";
import type {
	AuthEntry,
	CreateBasicEntryResponse,
	CreateTokenResponse,
} from "./entries";
import type { Group } from "./groups";

const tokenSetApiTransport = createFetchTransport({
	redirect: FetchTransportRedirectKind.Follow,
});
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
	transport?: HttpTransport;
	cancellationToken?: CancellationTokenTrait;
}

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
		source: TokenSetContextSource.Client,
	});
}

function createAuthorizedTokenSetApiTransport(
	client: AuthorizationHeaderProviderTrait,
	options: TokenSetApiRequestOptions,
): HttpTransport {
	return createTokenSetAuthorizedTransport(client, {
		transport: options.transport ?? tokenSetApiTransport,
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
		cancellationToken: options.cancellationToken,
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
		cancellationToken: options.cancellationToken,
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
		cancellationToken: options.cancellationToken,
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
		cancellationToken: options.cancellationToken,
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
		cancellationToken: options.cancellationToken,
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
