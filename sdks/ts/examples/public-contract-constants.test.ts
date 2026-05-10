import {
	AuthGuardRedirectStatus,
	AuthGuardResultKind,
} from "@securitydept/basic-auth-context-client";
import {
	ClientErrorKind,
	ClientErrorSource,
	UserRecovery,
} from "@securitydept/client";
import { SessionContextSource } from "@securitydept/session-context-client";
import {
	AuthenticationSourceKind,
	BackendOidcModeContextSource,
	BackendOidcModeStateRestoreSourceKind,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	BackendOidcModeBootstrapSource,
	createBackendOidcModeWebClientEnvironment,
	restoreBackendOidcModeClient,
} from "@securitydept/token-set-context-client/backend-oidc-mode/web";
import { describe, expect, it } from "vitest";

describe("public contract constants", () => {
	it("keeps exported client error vocabulary stable", () => {
		expect(ClientErrorKind.Cancelled).toBe("cancelled");
		expect(ClientErrorKind.Unauthenticated).toBe("unauthenticated");
		expect(ClientErrorSource.Transport).toBe("transport");
		expect(ClientErrorSource.ClientEnvironment).toBe("client_environment");
		expect(UserRecovery.Reauthenticate).toBe("reauthenticate");
		expect(UserRecovery.Retry).toBe("retry");
	});

	it("keeps exported auth guard vocabulary stable", () => {
		expect(AuthGuardResultKind.Ok).toBe("ok");
		expect(AuthGuardResultKind.Redirect).toBe("redirect");
		expect(AuthGuardRedirectStatus.Found).toBe(302);
		expect(AuthGuardRedirectStatus.TemporaryRedirect).toBe(307);
	});

	it("keeps exported token-set vocabulary stable", () => {
		expect(AuthenticationSourceKind.RefreshToken).toBe("refresh_token");
		expect(BackendOidcModeBootstrapSource.Callback).toBe("callback");
		expect(BackendOidcModeBootstrapSource.Restore).toBe("restore");
		expect(BackendOidcModeContextSource.Client).toBe(
			"backend_oidc_mode_client",
		);
		expect(BackendOidcModeContextSource.Persistence).toBe("backend-oidc-mode");
		expect(BackendOidcModeStateRestoreSourceKind.Manual).toBe("manual");
		expect(BackendOidcModeStateRestoreSourceKind.PersistentStore).toBe(
			"persistent_store",
		);
		expect(typeof createBackendOidcModeWebClientEnvironment).toBe("function");
		expect(typeof restoreBackendOidcModeClient).toBe("function");
	});

	it("keeps exported session vocabulary stable", () => {
		expect(SessionContextSource.SessionContext).toBe("session-context");
	});
});
