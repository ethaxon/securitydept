import { useQuery } from "@tanstack/react-query";

export interface ServerApiRoute {
	method: string;
	path: string;
	auth_required: boolean;
	description: string;
}

export interface ServerHealth {
	status: string;
	service: string;
	apis?: ServerApiRoute[];
}

async function fetchServerHealth(): Promise<ServerHealth> {
	const res = await fetch("/api/health?api_details=true");
	if (!res.ok) {
		throw new Error(`Health check failed: ${res.status}`);
	}
	return res.json();
}

export function useServerHealth() {
	return useQuery({
		queryKey: ["server-health", "api-details"],
		queryFn: fetchServerHealth,
		refetchInterval: 5_000,
		refetchIntervalInBackground: true,
		retry: false,
	});
}
