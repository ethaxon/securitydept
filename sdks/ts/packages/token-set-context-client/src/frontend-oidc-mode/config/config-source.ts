import {
	type CancellationTokenTrait,
	ClientError,
	ClientErrorKind,
	type FoundationEnvironment,
	type HttpResponse,
} from "@securitydept/client";
import { type FrontendOidcModeClientConfig } from "../client/types";
import {
	configProjectionToClientConfig,
	type FrontendOidcModeConfigProjection,
} from "../contracts/contracts";
import { validateConfigProjection } from "../contracts/parsers";
import { readConfigProjectionFromRealm } from "./config-projection-realm";
import {
	FrontendOidcModeConfigErrorCode,
	FrontendOidcModeConfigErrorSource,
} from "./error-codes";

const DEFAULT_PERSISTED_MAX_AGE_MS = 300_000;
const PERSISTED_STORAGE_KEY_PREFIX =
	"securitydept.frontend_oidc.config_projection:v1:";

export const FrontendOidcModeConfigProjectionSourceKind = {
	Inline: "inline",
	Realm: "realm",
	Persisted: "persisted",
	Network: "network",
} as const;

export type FrontendOidcModeConfigProjectionSourceKind =
	(typeof FrontendOidcModeConfigProjectionSourceKind)[keyof typeof FrontendOidcModeConfigProjectionSourceKind];

export interface FrontendOidcModeConfigProjectionInlineSource {
	readonly kind: typeof FrontendOidcModeConfigProjectionSourceKind.Inline;
	readonly projection: FrontendOidcModeConfigProjection;
}

export interface FrontendOidcModeConfigProjectionRealmSource {
	readonly kind: typeof FrontendOidcModeConfigProjectionSourceKind.Realm;
	readonly realm?: object;
	readonly key?: PropertyKey;
}

export interface FrontendOidcModeConfigProjectionPersistedSource {
	readonly kind: typeof FrontendOidcModeConfigProjectionSourceKind.Persisted;
	readonly storageKey?: string;
	readonly maxAgeMs?: number;
}

export interface FrontendOidcModeConfigProjectionNetworkSource {
	readonly kind: typeof FrontendOidcModeConfigProjectionSourceKind.Network;
	readonly endpoint: string;
}

export type FrontendOidcModeConfigProjectionSource =
	| FrontendOidcModeConfigProjectionInlineSource
	| FrontendOidcModeConfigProjectionRealmSource
	| FrontendOidcModeConfigProjectionPersistedSource
	| FrontendOidcModeConfigProjectionNetworkSource;

export interface ResolveFrontendOidcModeConfigProjectionOptions {
	readonly clientKey: string;
	readonly environment: FoundationEnvironment;
	readonly sources: readonly FrontendOidcModeConfigProjectionSource[];
	readonly overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>;
	readonly cancellationToken?: CancellationTokenTrait;
}

export interface ResolvedFrontendOidcModeConfigProjection {
	readonly projection: FrontendOidcModeConfigProjection;
	readonly config: FrontendOidcModeClientConfig;
	readonly sourceKind: FrontendOidcModeConfigProjectionSourceKind;
}

export async function resolveFrontendOidcModeConfigProjection(
	options: ResolveFrontendOidcModeConfigProjectionOptions,
): Promise<ResolvedFrontendOidcModeConfigProjection> {
	const { cancellationToken, clientKey, environment, overrides, sources } =
		options;
	cancellationToken?.throwIfCancellationRequested();
	const persistedSources = sources.filter(
		(source): source is FrontendOidcModeConfigProjectionPersistedSource =>
			source.kind === FrontendOidcModeConfigProjectionSourceKind.Persisted,
	);
	if (persistedSources.length > 1) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			code: FrontendOidcModeConfigErrorCode.MultiplePersistedSources,
			message:
				"Frontend OIDC config projection resolution accepts at most one persisted source",
			source: FrontendOidcModeConfigErrorSource,
		});
	}

	const persistedSource = persistedSources[0];
	const persistentStorage = environment.persistentStorage;
	const storageKey =
		persistedSource?.storageKey ??
		`${PERSISTED_STORAGE_KEY_PREFIX}${clientKey}`;

	for (const source of sources) {
		cancellationToken?.throwIfCancellationRequested();
		let projectionInput: unknown;

		switch (source.kind) {
			case FrontendOidcModeConfigProjectionSourceKind.Inline:
				projectionInput = source.projection;
				break;
			case FrontendOidcModeConfigProjectionSourceKind.Realm: {
				const realmResult = readConfigProjectionFromRealm({
					clientKey,
					realm: source.realm,
					key: source.key,
				});
				if (!realmResult.found) {
					continue;
				}
				projectionInput = realmResult.projection;
				break;
			}
			case FrontendOidcModeConfigProjectionSourceKind.Persisted: {
				if (!persistentStorage) {
					continue;
				}
				let raw: string | null;
				try {
					raw = await persistentStorage.get(storageKey);
				} catch (error) {
					cancellationToken?.throwIfCancellationRequested();
					throw new ClientError({
						kind: ClientErrorKind.Storage,
						code: FrontendOidcModeConfigErrorCode.PersistenceReadFailed,
						message:
							"The persisted frontend OIDC config projection could not be read",
						source: FrontendOidcModeConfigErrorSource,
						cause: error,
					});
				}
				cancellationToken?.throwIfCancellationRequested();
				if (raw === null) {
					continue;
				}
				try {
					projectionInput = JSON.parse(raw);
				} catch (error) {
					throw new ClientError({
						kind: ClientErrorKind.Protocol,
						code: FrontendOidcModeConfigErrorCode.InvalidProjection,
						message:
							"The persisted frontend OIDC config projection is not valid JSON",
						source: FrontendOidcModeConfigErrorSource,
						cause: error,
					});
				}
				break;
			}
			case FrontendOidcModeConfigProjectionSourceKind.Network: {
				let response: HttpResponse;
				try {
					response = await environment.transport.execute({
						url: source.endpoint,
						method: "GET",
						headers: { accept: "application/json" },
						cancellationToken,
					});
				} catch (error) {
					cancellationToken?.throwIfCancellationRequested();
					throw error;
				}
				cancellationToken?.throwIfCancellationRequested();
				if (response.status < 200 || response.status >= 300) {
					throw ClientError.fromHttpResponse({
						status: response.status,
						body: response.body,
						source: FrontendOidcModeConfigErrorSource,
					});
				}
				projectionInput = response.body;
				break;
			}
		}

		const validation = validateConfigProjection(projectionInput);
		if (!validation.success) {
			throw new ClientError({
				kind:
					source.kind === FrontendOidcModeConfigProjectionSourceKind.Inline
						? ClientErrorKind.Configuration
						: ClientErrorKind.Protocol,
				code: FrontendOidcModeConfigErrorCode.InvalidProjection,
				message: `Invalid frontend OIDC config projection from ${source.kind}`,
				source: FrontendOidcModeConfigErrorSource,
				cause: validation.issues,
			});
		}
		const projection = validation.value as FrontendOidcModeConfigProjection;

		if (
			source.kind === FrontendOidcModeConfigProjectionSourceKind.Persisted &&
			environment.time.now() - projection.generatedAt >
				(source.maxAgeMs ?? DEFAULT_PERSISTED_MAX_AGE_MS)
		) {
			continue;
		}

		if (
			persistentStorage &&
			persistedSource &&
			(source.kind === FrontendOidcModeConfigProjectionSourceKind.Realm ||
				source.kind === FrontendOidcModeConfigProjectionSourceKind.Network)
		) {
			cancellationToken?.throwIfCancellationRequested();
			try {
				await persistentStorage.set(storageKey, JSON.stringify(projection));
			} catch (error) {
				cancellationToken?.throwIfCancellationRequested();
				throw new ClientError({
					kind: ClientErrorKind.Storage,
					code: FrontendOidcModeConfigErrorCode.PersistenceWriteFailed,
					message:
						"The frontend OIDC config projection cache could not be written",
					source: FrontendOidcModeConfigErrorSource,
					cause: error,
				});
			}
			cancellationToken?.throwIfCancellationRequested();
		}

		return {
			projection,
			config: configProjectionToClientConfig(projection, overrides),
			sourceKind: source.kind,
		};
	}

	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		code: FrontendOidcModeConfigErrorCode.SourcesExhausted,
		message: `All frontend OIDC config projection sources were unavailable: ${sources.map((source) => source.kind).join(", ")}`,
		source: FrontendOidcModeConfigErrorSource,
	});
}
