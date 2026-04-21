import { BasicAuthContextClient } from "@securitydept/basic-auth-context-client";

export const basicAuthContextConfig = {
	baseUrl: "",
	zones: [{ zonePrefix: "/basic" }],
} as const;

export const basicAuthContextClient = new BasicAuthContextClient(
	basicAuthContextConfig,
);
