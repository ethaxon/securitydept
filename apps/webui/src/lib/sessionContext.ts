import {
	createExternalTransportForFetch,
	FetchTransportRedirectKind,
} from "@securitydept/client";
import { createSessionStorageStore } from "@securitydept/client/persistence/web";
import { createEnvironmentForNativeWeb } from "@securitydept/client/web";
import { SessionContextClient } from "@securitydept/session-context-client";

export const sessionContextConfig = {
	baseUrl: "",
} as const;

export const sessionContextSessionStore = createSessionStorageStore(
	"securitydept.webui.auth:",
);

export const sessionContextTransport = createExternalTransportForFetch({
	redirect: FetchTransportRedirectKind.Follow,
});

export const sessionContextEnvironment = createEnvironmentForNativeWeb({
	transport: sessionContextTransport,
	sessionStorage: sessionContextSessionStore,
	location: window.location,
	history: window.history,
	document,
	window,
});

export const sessionContextClient = new SessionContextClient(
	sessionContextConfig,
	{
		sessionStorage: sessionContextSessionStore,
	},
);
