// Router metadata — framework-agnostic route security declaration storage
//
// Canonical public export: @securitydept/client
//
// Serializable auth requirement metadata for router integrations is stored
// under a single namespaced key in each framework's route-data bag (Angular
// `Route.data`, TanStack `staticData`, etc.). Adopters should read/write only
// through {@link readSecuritydeptRouteMetadata} and
// {@link writeSecuritydeptRouteMetadata}.

import {
	type AuthRequirement,
	type RequirementsComposition,
} from "../auth-coordination/contract";

/** Route-data key holding the SecurityDept metadata blob for a segment. */
export const SECURITYDEPT_ROUTE_METADATA_KEY = "__securitydept__";

/** Serializable SecurityDept route metadata. */
export interface SecuritydeptRouteMetadata<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
> {
	requirements?: readonly TAuthRequirement[];
	composition?: RequirementsComposition;
}

/** Read SecurityDept route metadata from a route `data` bag. */
export function readSecuritydeptRouteMetadata<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
>(
	data: object | undefined,
): SecuritydeptRouteMetadata<TAuthRequirement> | undefined {
	const raw = (data as Record<string, unknown> | undefined)?.[
		SECURITYDEPT_ROUTE_METADATA_KEY
	];
	if (raw === undefined || raw === null) {
		return undefined;
	}
	return raw as SecuritydeptRouteMetadata<TAuthRequirement>;
}

/** Merge SecurityDept route metadata into a route `data` bag. */
export function writeSecuritydeptRouteMetadata<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
>(
	base: object | undefined,
	patch: SecuritydeptRouteMetadata<TAuthRequirement>,
): Record<string, unknown> {
	const data: Record<string, unknown> = { ...(base ?? {}) };
	const previous =
		(data[SECURITYDEPT_ROUTE_METADATA_KEY] as
			| SecuritydeptRouteMetadata<TAuthRequirement>
			| undefined) ?? {};
	data[SECURITYDEPT_ROUTE_METADATA_KEY] = { ...previous, ...patch };
	return data;
}
