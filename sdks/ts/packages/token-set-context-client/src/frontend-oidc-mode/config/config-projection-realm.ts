import { type FrontendOidcModeConfigProjection } from "../contracts/contracts";

export interface FrontendOidcModeConfigProjectionRealmOptions {
	readonly clientKey: string;
	readonly realm?: object;
	readonly key?: PropertyKey;
}

export interface InjectConfigProjectionIntoRealmOptions
	extends FrontendOidcModeConfigProjectionRealmOptions {
	readonly projection: FrontendOidcModeConfigProjection;
}

export type FrontendOidcModeConfigProjectionRealmReadResult =
	| { readonly found: false }
	| { readonly found: true; readonly projection: unknown };

export function resolveConfigProjectionRealmKey(
	options: Pick<
		FrontendOidcModeConfigProjectionRealmOptions,
		"clientKey" | "key"
	>,
): PropertyKey {
	return (
		options.key ??
		Symbol.for(
			`securitydept.frontend_oidc.config_projection:v1:${options.clientKey}`,
		)
	);
}

export function injectConfigProjectionIntoRealm(
	options: InjectConfigProjectionIntoRealmOptions,
): void {
	Reflect.set(
		options.realm ?? globalThis,
		resolveConfigProjectionRealmKey(options),
		options.projection,
	);
}

export function readConfigProjectionFromRealm(
	options: FrontendOidcModeConfigProjectionRealmOptions,
): FrontendOidcModeConfigProjectionRealmReadResult {
	const realm = options.realm ?? globalThis;
	const key = resolveConfigProjectionRealmKey(options);
	return Reflect.has(realm, key)
		? { found: true, projection: Reflect.get(realm, key) }
		: { found: false };
}
