import { FetchTransportRedirectKind } from "@securitydept/client";
import { createSessionStorageStore } from "@securitydept/client/persistence/web";
import { createFetchTransport } from "@securitydept/client/web";
import { SessionContextClient } from "@securitydept/session-context-client";

export const sessionContextConfig = {
	baseUrl: "",
} as const;

export const sessionContextSessionStore = createSessionStorageStore(
	"securitydept.webui.auth:",
);

export const sessionContextTransport = createFetchTransport({
	redirect: FetchTransportRedirectKind.Follow,
});

export const sessionContextClient = new SessionContextClient(
	sessionContextConfig,
	{
		sessionStore: sessionContextSessionStore,
	},
);
