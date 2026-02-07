export interface EntrySearch {
	name?: string;
	kind?: "basic" | "token";
	username?: string;
	group_ids?: string[];
}

function normalizeString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeIds(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const ids = value
			.filter((v): v is string => typeof v === "string")
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
		return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
	}

	if (typeof value === "string") {
		const ids = value
			.split(",")
			.map((v) => v.trim())
			.filter((v) => v.length > 0);
		return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
	}

	return undefined;
}

export function parseEntrySearch(search: Record<string, unknown>): EntrySearch {
	const kindRaw = normalizeString(search.kind);
	const kind = kindRaw === "basic" || kindRaw === "token" ? kindRaw : undefined;

	return {
		name: normalizeString(search.name),
		kind,
		username: normalizeString(search.username),
		group_ids: normalizeIds(search.group_ids),
	};
}
