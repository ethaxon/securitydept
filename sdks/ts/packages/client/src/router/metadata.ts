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
export interface SecuritydeptRouteMetadata {
	requirements?: readonly AuthRequirement[];
	composition?: RequirementsComposition;
}

/** Read SecurityDept route metadata from a route `data` bag. */
export function readSecuritydeptRouteMetadata(
	data: Record<string, unknown> | undefined,
): SecuritydeptRouteMetadata | undefined {
	const raw = data?.[SECURITYDEPT_ROUTE_METADATA_KEY];
	if (raw === undefined || raw === null) {
		return undefined;
	}
	return raw as SecuritydeptRouteMetadata;
}

/** Merge SecurityDept route metadata into a route `data` bag. */
export function writeSecuritydeptRouteMetadata(
	base: Record<string, unknown> | undefined,
	patch: SecuritydeptRouteMetadata,
): Record<string, unknown> {
	const data: Record<string, unknown> = { ...(base ?? {}) };
	const previous =
		(data[SECURITYDEPT_ROUTE_METADATA_KEY] as
			| SecuritydeptRouteMetadata
			| undefined) ?? {};
	data[SECURITYDEPT_ROUTE_METADATA_KEY] = { ...previous, ...patch };
	return data;
}
