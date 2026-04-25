import {
	BasicAuthContextClient,
	type BasicAuthContextClientConfig,
} from "@securitydept/basic-auth-context-client";

export const basicAuthContextConfig: BasicAuthContextClientConfig = {
	baseUrl: "",
	zones: [{ zonePrefix: "/basic" }],
};

export const basicAuthContextClient = new BasicAuthContextClient(
	basicAuthContextConfig,
);
