import { ClientError } from "@securitydept/client";
import { type DashboardAccess } from "@/lib/auth/authService";
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
	const res = await fetch(`${access.basePath}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options.headers,
		},
	});
	if (!res.ok) {
		const body = await res.json().catch(() => undefined);
		throw ClientError.fromHttpResponse(res.status, body);
	}
	return res.json();
}

function tokenSetOptions(
	options: DashboardRequestOptions = {},
): TokenSetApiRequestOptions {
	return { abortSignal: options.abortSignal };
}

export async function listGroups(
	access: DashboardAccess,
	options: DashboardRequestOptions = {},
): Promise<Group[]> {
	if (access.kind === "token-set") {
		return listGroupsWithTokenSet(access.client, tokenSetOptions(options));
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
			tokenSetOptions(options),
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
		return createGroupWithTokenSet(access.client, input);
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
		return updateGroupWithTokenSet(access.client, groupId, input);
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
		await deleteGroupWithTokenSet(access.client, groupId);
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
		return listEntriesWithTokenSet(access.client, tokenSetOptions(options));
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
			tokenSetOptions(options),
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
		return createBasicEntryWithTokenSet(access.client, input);
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
		return createTokenEntryWithTokenSet(access.client, input);
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
		return updateEntryWithTokenSet(access.client, entryId, input);
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
		await deleteEntryWithTokenSet(access.client, entryId);
		return;
	}
	await request(access, `/api/entries/${encodeURIComponent(entryId)}`, {
		method: "DELETE",
	});
}
