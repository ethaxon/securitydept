import type { RecordStore } from "@securitydept/client";
import { ClientError, ClientErrorKind } from "@securitydept/client";
import { type AuthStateSnapshot, TokenSetContextSource } from "./types";

const TOKEN_SET_STATE_VERSION = 1;

interface StoredTokenSetStateEnvelope {
	version: number;
	storedAt: number;
	value: AuthStateSnapshot;
}

export interface TokenSetStatePersistence {
	load(): Promise<AuthStateSnapshot | null>;
	save(snapshot: AuthStateSnapshot): Promise<void>;
	clear(): Promise<void>;
}

export function createTokenSetStatePersistence(options: {
	store: RecordStore;
	key: string;
	now: () => number;
}): TokenSetStatePersistence {
	return {
		async load(): Promise<AuthStateSnapshot | null> {
			const raw = await options.store.get(options.key);
			if (raw === null) {
				return null;
			}

			const parsed = parseEnvelope(raw);
			return parsed.value;
		},

		async save(snapshot: AuthStateSnapshot): Promise<void> {
			const envelope: StoredTokenSetStateEnvelope = {
				version: TOKEN_SET_STATE_VERSION,
				storedAt: options.now(),
				value: snapshot,
			};

			await options.store.set(options.key, JSON.stringify(envelope));
		},

		async clear(): Promise<void> {
			await options.store.remove(options.key);
		},
	};
}

function parseEnvelope(raw: string): StoredTokenSetStateEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "token_set.persistence.invalid_json",
			message: "Persisted token-set state is not valid JSON",
			source: TokenSetContextSource.Persistence,
			cause,
		});
	}

	if (
		!parsed ||
		typeof parsed !== "object" ||
		!("version" in parsed) ||
		!("value" in parsed)
	) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "token_set.persistence.invalid_envelope",
			message: "Persisted token-set state has an invalid envelope",
			source: TokenSetContextSource.Persistence,
		});
	}

	const envelope = parsed as Partial<StoredTokenSetStateEnvelope>;

	if (envelope.version !== TOKEN_SET_STATE_VERSION) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "token_set.persistence.unsupported_version",
			message: `Unsupported token-set state version: ${String(envelope.version)}`,
			source: TokenSetContextSource.Persistence,
		});
	}

	if (!isAuthStateSnapshot(envelope.value)) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "token_set.persistence.invalid_snapshot",
			message: "Persisted token-set state payload is invalid",
			source: TokenSetContextSource.Persistence,
		});
	}

	return {
		version: TOKEN_SET_STATE_VERSION,
		storedAt:
			typeof envelope.storedAt === "number" ? envelope.storedAt : Date.now(),
		value: envelope.value,
	};
}

function isAuthStateSnapshot(value: unknown): value is AuthStateSnapshot {
	if (!value || typeof value !== "object") {
		return false;
	}

	const snapshot = value as Partial<AuthStateSnapshot>;
	const tokens = snapshot.tokens as
		| Partial<AuthStateSnapshot["tokens"]>
		| undefined;
	const metadata = snapshot.metadata;

	return (
		!!tokens &&
		typeof tokens === "object" &&
		typeof tokens.accessToken === "string" &&
		!!metadata &&
		typeof metadata === "object"
	);
}
