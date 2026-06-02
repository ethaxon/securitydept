export const tokenSetQueryKeys = {
	all: ["tokenSetContext"] as const,
	forClient: (clientKey: string) =>
		[...tokenSetQueryKeys.all, clientKey] as const,
	readiness: (clientKey: string) =>
		[...tokenSetQueryKeys.forClient(clientKey), "readiness"] as const,
} as const;
