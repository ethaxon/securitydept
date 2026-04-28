export const TokenHandleKind = {
	AccessToken: "access_token",
	RefreshMaterial: "refresh_material",
	IdToken: "id_token",
} as const;

export type TokenHandleKind =
	(typeof TokenHandleKind)[keyof typeof TokenHandleKind];

export interface TokenHandleDescriptor {
	id: string;
	kind: TokenHandleKind;
	clientKey?: string;
	issuedAt: number;
	expiresAt?: number;
}

export interface IssueTokenHandleOptions {
	kind: TokenHandleKind;
	token: string;
	clientKey?: string;
	expiresAt?: number;
	ttlMs?: number;
}

export interface TokenHandleStore {
	issue(options: IssueTokenHandleOptions): TokenHandleDescriptor;
	get(handle: TokenHandleDescriptor | string): string | null;
	consume(handle: TokenHandleDescriptor | string): string | null;
	revoke(handle: TokenHandleDescriptor | string): void;
	clearByClient(clientKey: string): void;
	clear(): void;
}

interface StoredTokenHandle {
	descriptor: TokenHandleDescriptor;
	token: string;
}

export interface CreateTokenHandleStoreOptions {
	now?: () => number;
	idPrefix?: string;
}

export function createTokenHandleStore(
	options: CreateTokenHandleStoreOptions = {},
): TokenHandleStore {
	const now = options.now ?? (() => Date.now());
	const idPrefix = options.idPrefix ?? "token-handle";
	let sequence = 0;
	const handles = new Map<string, StoredTokenHandle>();

	const isExpired = (descriptor: TokenHandleDescriptor): boolean =>
		descriptor.expiresAt !== undefined && descriptor.expiresAt <= now();

	const resolve = (
		handle: TokenHandleDescriptor | string,
	): StoredTokenHandle | null => {
		const id = typeof handle === "string" ? handle : handle.id;
		const stored = handles.get(id);
		if (!stored) return null;
		if (isExpired(stored.descriptor)) {
			handles.delete(id);
			return null;
		}
		return stored;
	};

	return {
		issue(options) {
			const issuedAt = now();
			const descriptor: TokenHandleDescriptor = {
				id: `${idPrefix}-${++sequence}`,
				kind: options.kind,
				clientKey: options.clientKey,
				issuedAt,
				expiresAt:
					options.expiresAt ??
					(options.ttlMs !== undefined ? issuedAt + options.ttlMs : undefined),
			};
			handles.set(descriptor.id, { descriptor, token: options.token });
			return descriptor;
		},
		get(handle) {
			return resolve(handle)?.token ?? null;
		},
		consume(handle) {
			const stored = resolve(handle);
			if (!stored) return null;
			handles.delete(stored.descriptor.id);
			return stored.token;
		},
		revoke(handle) {
			const id = typeof handle === "string" ? handle : handle.id;
			handles.delete(id);
		},
		clearByClient(clientKey) {
			for (const [id, stored] of handles) {
				if (stored.descriptor.clientKey === clientKey) handles.delete(id);
			}
		},
		clear() {
			handles.clear();
		},
	};
}
