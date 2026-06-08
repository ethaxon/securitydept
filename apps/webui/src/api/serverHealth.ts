import { type BaseTransportTrait, ClientError } from "@securitydept/client";
import { useQuery } from "@tanstack/react-query";

export const ServerApiRouteAuthBoundary = {
	Public: "public",
	Dashboard: "dashboard",
	BasicAuth: "basic_auth",
	Protocol: "protocol",
	ForwardAuth: "forward_auth",
	ConditionalPropagation: "conditional_propagation",
} as const;

export type ServerApiRouteAuthBoundary =
	(typeof ServerApiRouteAuthBoundary)[keyof typeof ServerApiRouteAuthBoundary];

export const ServerApiRouteAvailability = {
	Always: "always",
	ConditionalEnabled: "conditional_enabled",
	ConditionalDisabled: "conditional_disabled",
} as const;

export type ServerApiRouteAvailability =
	(typeof ServerApiRouteAvailability)[keyof typeof ServerApiRouteAvailability];

export interface ServerApiRoute {
	method: string;
	path: string;
	auth_required: boolean;
	auth_boundary: ServerApiRouteAuthBoundary;
	availability: ServerApiRouteAvailability;
	description: string;
}

export interface ServerHealth {
	status: string;
	service: string;
	apis?: ServerApiRoute[];
}

const apiRouteAuthBoundaryLabels: Record<ServerApiRouteAuthBoundary, string> = {
	[ServerApiRouteAuthBoundary.Public]: "Public",
	[ServerApiRouteAuthBoundary.Dashboard]: "Dashboard",
	[ServerApiRouteAuthBoundary.BasicAuth]: "Basic Auth",
	[ServerApiRouteAuthBoundary.Protocol]: "Protocol",
	[ServerApiRouteAuthBoundary.ForwardAuth]: "Forward Auth",
	[ServerApiRouteAuthBoundary.ConditionalPropagation]:
		"Conditional Propagation",
};

const apiRouteAvailabilityLabels: Record<ServerApiRouteAvailability, string> = {
	[ServerApiRouteAvailability.Always]: "Always",
	[ServerApiRouteAvailability.ConditionalEnabled]: "Enabled",
	[ServerApiRouteAvailability.ConditionalDisabled]: "Disabled",
};

export function describeApiRouteAuthBoundary(route: ServerApiRoute): string {
	return apiRouteAuthBoundaryLabels[route.auth_boundary];
}

export function describeApiRouteAvailability(route: ServerApiRoute): string {
	return apiRouteAvailabilityLabels[route.availability];
}

export async function fetchServerHealth(
	transport: BaseTransportTrait,
): Promise<ServerHealth> {
	const response = await transport.execute({
		url: "/api/health?api_details=true",
		method: "GET",
		headers: { accept: "application/json" },
	});
	if (response.status !== 200) {
		throw ClientError.fromHttpResponse({
			status: response.status,
			body: response.body,
		});
	}
	return response.body as ServerHealth;
}

export function useServerHealth(transport: BaseTransportTrait) {
	return useQuery({
		queryKey: ["server-health", "api-details"],
		queryFn: () => fetchServerHealth(transport),
		refetchInterval: 5_000,
		refetchIntervalInBackground: true,
		retry: false,
	});
}
