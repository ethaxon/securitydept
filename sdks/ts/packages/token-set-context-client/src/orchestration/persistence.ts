import type { RecordStore } from "@securitydept/client";
import { ClientError, ClientErrorKind } from "@securitydept/client";
import type { AuthSnapshot } from "./types";

const STATE_VERSION = 1;
const PERSISTENCE_SOURCE = "token-orchestration-persistence";

interface StoredStateEnvelope {
	version: number;
	storedAt: number;
	value: AuthSnapshot;
}

/**
 * Generic auth state persistence.
 *
 * This persistence layer is protocol-agnostic: it stores / loads an
 * AuthSnapshot without caring whether the snapshot came from a
 * OIDC-mediated sealed flow or a standard OIDC exchange.
 */
export interface AuthStatePersistence {
	load(): Promise<AuthSnapshot | null>;
	save(snapshot: AuthSnapshot): Promise<void>;
	clear(): Promise<void>;
}

/**
 * Configuration options for creating auth state persistence.
 */
export interface CreateAuthStatePersistenceOptions {
	store: RecordStore;
	key: string;
	now: () => number;
}

export function createAuthStatePersistence(
	options: CreateAuthStatePersistenceOptions,
): AuthStatePersistence {
	return {
		async load(): Promise<AuthSnapshot | null> {
			const raw = await options.store.get(options.key);
			if (raw === null) {
				return null;
			}

			const parsed = parseEnvelope(raw);
			return parsed.value;
		},

		async save(snapshot: AuthSnapshot): Promise<void> {
			const envelope: StoredStateEnvelope = {
				version: STATE_VERSION,
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

function parseEnvelope(raw: string): StoredStateEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "token_orchestration.persistence.invalid_json",
			message: "Persisted auth state is not valid JSON",
			source: PERSISTENCE_SOURCE,
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
			code: "token_orchestration.persistence.invalid_envelope",
			message: "Persisted auth state has an invalid envelope",
			source: PERSISTENCE_SOURCE,
		});
	}

	const envelope = parsed as Partial<StoredStateEnvelope>;

	if (envelope.version !== STATE_VERSION) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "token_orchestration.persistence.unsupported_version",
			message: `Unsupported auth state version: ${String(envelope.version)}`,
			source: PERSISTENCE_SOURCE,
		});
	}

	if (!isAuthSnapshot(envelope.value)) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: "token_orchestration.persistence.invalid_snapshot",
			message: "Persisted auth state payload is invalid",
			source: PERSISTENCE_SOURCE,
		});
	}

	return {
		version: STATE_VERSION,
		storedAt:
			typeof envelope.storedAt === "number" ? envelope.storedAt : Date.now(),
		value: envelope.value,
	};
}

function isAuthSnapshot(value: unknown): value is AuthSnapshot {
	if (!value || typeof value !== "object") {
		return false;
	}

	const snapshot = value as Partial<AuthSnapshot>;
	const tokens = snapshot.tokens as Partial<AuthSnapshot["tokens"]> | undefined;
	const metadata = snapshot.metadata;

	return (
		!!tokens &&
		typeof tokens === "object" &&
		typeof tokens.accessToken === "string" &&
		!!metadata &&
		typeof metadata === "object"
	);
}
