import { type BasicAuthContextClientConfig } from "@securitydept/basic-auth-context-client";

export const basicAuthContextConfig: BasicAuthContextClientConfig = {
	baseUrl: "",
	probePath: "/basic/api/entries",
	zones: [{ zonePrefix: "/basic" }],
};
