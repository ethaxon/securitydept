import {
	createBaseTransportForStdFetch,
	createRootSpan,
	createTracing,
	FetchTransportRedirectKind,
} from "@securitydept/client";
import {
	createEnvironmentForNativeWeb,
	createSessionStorageForNativeWeb,
} from "@securitydept/client/web";
import { SessionContextClient } from "@securitydept/session-context-client";

export const sessionContextConfig = {
	baseUrl: "",
} as const;

export const sessionContextSessionStore =
	createSessionStorageForNativeWeb({
		prefix: "securitydept.webui.auth:",
	}) ?? failMissingSessionStorage();

export const sessionContextTransport = createBaseTransportForStdFetch({
	redirect: FetchTransportRedirectKind.Follow,
});

export const sessionContextEnvironment = createEnvironmentForNativeWeb({
	transport: sessionContextTransport,
	sessionStorage: sessionContextSessionStore,
	span: createRootSpan(),
	tracing: createTracing(),
	routerForNativeWebCreateOptions: {
		location: window.location,
		history: window.history,
	},
	pageLifecycleForNativeWebCreateOptions: {
		document,
		window,
	},
	popupForNativeWebCreateOptions: {
		window,
	},
});

export const sessionContextClient = new SessionContextClient(
	sessionContextConfig,
	{
		sessionStorage: sessionContextSessionStore,
	},
);

function failMissingSessionStorage(): never {
	throw new Error("WebUI session context requires browser sessionStorage.");
}
