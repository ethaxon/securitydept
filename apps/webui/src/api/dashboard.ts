import {
	abortSignalToCancellationToken,
	ClientError,
} from "@securitydept/client";
import { type DashboardAccess } from "@/auth/model";
import {
	type AuthEntry,
	type CreateBasicEntryResponse,
	type CreateTokenResponse,
} from "./entries";
import { type Group } from "./groups";
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
	type TokenSetApiRequestOptions,
	type UpdateEntryWithTokenSetRequest,
	type UpdateGroupWithTokenSetRequest,
	updateEntryWithTokenSet,
	updateGroupWithTokenSet,
} from "./tokenSet";

export interface DashboardRequestOptions {
	readonly abortSignal?: AbortSignal;
}

export type CreateGroupRequest = CreateGroupWithTokenSetRequest;
export type UpdateGroupRequest = UpdateGroupWithTokenSetRequest;
export type CreateBasicEntryRequest = CreateBasicEntryWithTokenSetRequest;
export type CreateTokenEntryRequest = CreateTokenEntryWithTokenSetRequest;
export type UpdateEntryRequest = UpdateEntryWithTokenSetRequest;

async function request<T>(
	access: DashboardAccess,
	path: string,
	options: RequestInit = {},
): Promise<T> {
	if (access.kind !== "cookie") {
		throw new Error("Dashboard cookie request received token-set access.");
	}
	const response = await access.transport.execute({
		url: `${access.basePath}${path}`,
		method: options.method ?? "GET",
		headers: {
			"content-type": "application/json",
			...(options.headers as Record<string, string> | undefined),
		},
		body: options.body as string | undefined,
		cancellationToken: abortSignalToCancellationToken(
			options.signal ?? undefined,
		),
	});
	if (response.status < 200 || response.status >= 300) {
		throw ClientError.fromHttpResponse({
			status: response.status,
			body: response.body,
		});
	}
	return response.body as T;
}

function tokenSetOptions(
	access: Extract<DashboardAccess, { kind: "token-set" }>,
	options: DashboardRequestOptions = {},
): TokenSetApiRequestOptions {
	return {
		transport: access.transport,
		abortSignal: options.abortSignal,
	};
}

export async function listGroups(
	access: DashboardAccess,
	options: DashboardRequestOptions = {},
): Promise<Group[]> {
	if (access.kind === "token-set") {
		return listGroupsWithTokenSet(
			access.client,
			tokenSetOptions(access, options),
		);
	}
	return request<Group[]>(access, "/api/groups", {
		signal: options.abortSignal,
	});
}

export async function getGroup(
	access: DashboardAccess,
	groupId: string,
	options: DashboardRequestOptions = {},
): Promise<Group> {
	if (access.kind === "token-set") {
		return getGroupWithTokenSet(
			access.client,
			groupId,
			tokenSetOptions(access, options),
		);
	}
	return request<Group>(access, `/api/groups/${encodeURIComponent(groupId)}`, {
		signal: options.abortSignal,
	});
}

export async function createGroup(
	access: DashboardAccess,
	input: CreateGroupRequest,
): Promise<Group> {
	if (access.kind === "token-set") {
		return createGroupWithTokenSet(
			access.client,
			input,
			tokenSetOptions(access),
		);
	}
	return request<Group>(access, "/api/groups", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export async function updateGroup(
	access: DashboardAccess,
	groupId: string,
	input: UpdateGroupRequest,
): Promise<Group> {
	if (access.kind === "token-set") {
		return updateGroupWithTokenSet(
			access.client,
			groupId,
			input,
			tokenSetOptions(access),
		);
	}
	return request<Group>(access, `/api/groups/${encodeURIComponent(groupId)}`, {
		method: "PUT",
		body: JSON.stringify(input),
	});
}

export async function deleteGroup(
	access: DashboardAccess,
	groupId: string,
): Promise<void> {
	if (access.kind === "token-set") {
		await deleteGroupWithTokenSet(
			access.client,
			groupId,
			tokenSetOptions(access),
		);
		return;
	}
	await request(access, `/api/groups/${encodeURIComponent(groupId)}`, {
		method: "DELETE",
	});
}

export async function listEntries(
	access: DashboardAccess,
	options: DashboardRequestOptions = {},
): Promise<AuthEntry[]> {
	if (access.kind === "token-set") {
		return listEntriesWithTokenSet(
			access.client,
			tokenSetOptions(access, options),
		);
	}
	return request<AuthEntry[]>(access, "/api/entries", {
		signal: options.abortSignal,
	});
}

export async function getEntry(
	access: DashboardAccess,
	entryId: string,
	options: DashboardRequestOptions = {},
): Promise<AuthEntry> {
	if (access.kind === "token-set") {
		return getEntryWithTokenSet(
			access.client,
			entryId,
			tokenSetOptions(access, options),
		);
	}
	return request<AuthEntry>(
		access,
		`/api/entries/${encodeURIComponent(entryId)}`,
		{ signal: options.abortSignal },
	);
}

export async function createBasicEntry(
	access: DashboardAccess,
	input: CreateBasicEntryRequest,
): Promise<CreateBasicEntryResponse> {
	if (access.kind === "token-set") {
		return createBasicEntryWithTokenSet(
			access.client,
			input,
			tokenSetOptions(access),
		);
	}
	return request<CreateBasicEntryResponse>(access, "/api/entries/basic", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export async function createTokenEntry(
	access: DashboardAccess,
	input: CreateTokenEntryRequest,
): Promise<CreateTokenResponse> {
	if (access.kind === "token-set") {
		return createTokenEntryWithTokenSet(
			access.client,
			input,
			tokenSetOptions(access),
		);
	}
	return request<CreateTokenResponse>(access, "/api/entries/token", {
		method: "POST",
		body: JSON.stringify(input),
	});
}

export async function updateEntry(
	access: DashboardAccess,
	entryId: string,
	input: UpdateEntryRequest,
): Promise<AuthEntry> {
	if (access.kind === "token-set") {
		return updateEntryWithTokenSet(
			access.client,
			entryId,
			input,
			tokenSetOptions(access),
		);
	}
	return request<AuthEntry>(
		access,
		`/api/entries/${encodeURIComponent(entryId)}`,
		{
			method: "PUT",
			body: JSON.stringify(input),
		},
	);
}

export async function deleteEntry(
	access: DashboardAccess,
	entryId: string,
): Promise<void> {
	if (access.kind === "token-set") {
		await deleteEntryWithTokenSet(
			access.client,
			entryId,
			tokenSetOptions(access),
		);
		return;
	}
	await request(access, `/api/entries/${encodeURIComponent(entryId)}`, {
		method: "DELETE",
	});
}
