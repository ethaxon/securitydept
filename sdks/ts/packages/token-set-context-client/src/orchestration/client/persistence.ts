import {
	ClientError,
	ClientErrorKind,
	formatValidationFailure,
	type StorageTrait,
	type TimestampProviderTrait,
	type ValidationFailure,
	validateWithSchemaSync,
} from "@securitydept/client";
import { type as defineType } from "arktype";
import { type TokenSetAuthSnapshot } from "../token/types";

const STATE_VERSION = 1;
const PERSISTENCE_SOURCE = "token_set.persistence";

export const TokenSetPersistenceErrorCode = {
	Unavailable: "token_set.persistence.unavailable",
	IoFailed: "token_set.persistence.io_failed",
	InvalidJson: "token_set.persistence.invalid_json",
	InvalidEnvelope: "token_set.persistence.invalid_envelope",
	UnsupportedVersion: "token_set.persistence.unsupported_version",
	InvalidSnapshot: "token_set.persistence.invalid_snapshot",
} as const;

export type TokenSetPersistenceErrorCode =
	(typeof TokenSetPersistenceErrorCode)[keyof typeof TokenSetPersistenceErrorCode];

interface StoredStateEnvelope {
	version: number;
	storedAt: number;
	value: TokenSetAuthSnapshot;
}

const AuthSnapshotSchema = defineType({
	tokens: {
		accessToken: "string",
		"idToken?": "string",
		"refreshMaterial?": "string",
		"accessTokenIssuedAt?": "string",
		"accessTokenExpiresAt?": "string",
	},
	metadata: "object",
});

const StoredStateEnvelopeShapeSchema = defineType({
	version: "number",
	"storedAt?": "number",
	value: "unknown",
});

export interface TokenSetAuthSnapshotPersistenceOptions {
	store: StorageTrait;
	key: string;
	time: TimestampProviderTrait;
}

export async function loadPersistedAuthSnapshot(
	options: TokenSetAuthSnapshotPersistenceOptions,
): Promise<TokenSetAuthSnapshot | null> {
	let raw: string | null;
	try {
		raw = await options.store.get(options.key);
	} catch (error) {
		throw new ClientError({
			kind: ClientErrorKind.Storage,
			code: TokenSetPersistenceErrorCode.IoFailed,
			message: "Persisted token-set state could not be read",
			source: PERSISTENCE_SOURCE,
			cause: error,
		});
	}
	if (raw === null) {
		return null;
	}

	const parsed = parseEnvelope(raw, options.time.now);
	return parsed.value;
}

export async function savePersistedAuthSnapshot(
	options: TokenSetAuthSnapshotPersistenceOptions,
	snapshot: TokenSetAuthSnapshot,
): Promise<void> {
	try {
		await options.store.set(
			options.key,
			serializePersistedTokenSetAuthSnapshot(options, snapshot),
		);
	} catch (error) {
		throw new ClientError({
			kind: ClientErrorKind.Storage,
			code: TokenSetPersistenceErrorCode.IoFailed,
			message: "Persisted token-set state could not be written",
			source: PERSISTENCE_SOURCE,
			cause: error,
		});
	}
}

export async function clearPersistedAuthSnapshot(
	options: Pick<TokenSetAuthSnapshotPersistenceOptions, "store" | "key">,
): Promise<void> {
	try {
		await options.store.remove(options.key);
	} catch (error) {
		throw new ClientError({
			kind: ClientErrorKind.Storage,
			code: TokenSetPersistenceErrorCode.IoFailed,
			message: "Persisted token-set state could not be cleared",
			source: PERSISTENCE_SOURCE,
			cause: error,
		});
	}
}

export function serializePersistedTokenSetAuthSnapshot(
	options: Pick<TokenSetAuthSnapshotPersistenceOptions, "time">,
	snapshot: TokenSetAuthSnapshot,
): string {
	const envelope: StoredStateEnvelope = {
		version: STATE_VERSION,
		storedAt: options.time.now(),
		value: snapshot,
	};

	return JSON.stringify(envelope);
}

function parseEnvelope(raw: string, now: () => number): StoredStateEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (cause) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: TokenSetPersistenceErrorCode.InvalidJson,
			message: "Persisted auth state is not valid JSON",
			source: PERSISTENCE_SOURCE,
			cause,
		});
	}

	const envelopeShapeResult = validateWithSchemaSync(
		StoredStateEnvelopeShapeSchema,
		parsed,
	);
	if (!envelopeShapeResult.success) {
		throwPersistenceValidationError({
			code: TokenSetPersistenceErrorCode.InvalidEnvelope,
			messagePrefix: "Persisted auth state has an invalid envelope",
			failure: envelopeShapeResult,
		});
	}

	const envelope = envelopeShapeResult.value;

	if (envelope.version !== STATE_VERSION) {
		throw new ClientError({
			kind: ClientErrorKind.Protocol,
			code: TokenSetPersistenceErrorCode.UnsupportedVersion,
			message: `Unsupported auth state version: ${String(envelope.version)}`,
			source: PERSISTENCE_SOURCE,
		});
	}

	const authSnapshotResult = validateWithSchemaSync(
		AuthSnapshotSchema,
		envelope.value,
	);
	if (!authSnapshotResult.success) {
		throwPersistenceValidationError({
			code: TokenSetPersistenceErrorCode.InvalidSnapshot,
			messagePrefix: "Persisted auth state payload is invalid",
			failure: authSnapshotResult,
		});
	}

	return {
		version: STATE_VERSION,
		storedAt: envelope.storedAt ?? now(),
		value: authSnapshotResult.value,
	};
}

function throwPersistenceValidationError(options: {
	code: string;
	messagePrefix: string;
	failure: ValidationFailure;
}): never {
	const issueSummary = formatValidationFailure(options.failure);
	throw new ClientError({
		kind: ClientErrorKind.Protocol,
		code: options.code,
		message: issueSummary
			? `${options.messagePrefix}: ${issueSummary}.`
			: `${options.messagePrefix}.`,
		source: PERSISTENCE_SOURCE,
		cause: options.failure.issues,
	});
}
