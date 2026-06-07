import {
	type AuthRequirement,
	type RouteTreeSegment,
	readSecuritydeptRouteMetadata,
} from "@securitydept/client";

export interface TanStackRouteMatchLike {
	readonly id?: string;
	readonly routeId?: string;
	readonly pathname?: string;
	readonly staticData?: object;
}

export function projectTanStackRouteSegments<
	TAuthRequirement extends AuthRequirement = AuthRequirement,
>(
	matches: readonly TanStackRouteMatchLike[],
): RouteTreeSegment<TAuthRequirement>[] {
	return matches.map((match, index) => {
		const metadata = readSecuritydeptRouteMetadata<TAuthRequirement>(
			match.staticData,
		);
		return {
			routeId:
				match.routeId ??
				match.id ??
				match.pathname ??
				`tanstack-route-${index}`,
			requirements: metadata?.requirements ?? [],
			composition: metadata?.composition,
		};
	});
}
