export const AuthEntryKind = {
	Basic: "basic",
	Token: "token",
} as const;

export type AuthEntryKind = (typeof AuthEntryKind)[keyof typeof AuthEntryKind];

export interface AuthEntry {
	id: string;
	name: string;
	kind: AuthEntryKind;
	username?: string;
	group_ids: string[];
	created_at: string;
	updated_at: string;
}

export type CreateBasicEntryResponse = {
	entry: AuthEntry;
};

export type CreateTokenResponse = {
	entry: AuthEntry;
	token: string;
};
