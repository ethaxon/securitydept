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
	BackendOidcMediatedModeContextSource,
	BackendOidcMediatedModeStateRestoreSourceKind,
} from "@securitydept/token-set-context-client/backend-oidc-mediated-mode";
import { BackendOidcMediatedModeBootstrapSource } from "@securitydept/token-set-context-client/backend-oidc-mediated-mode/web";
import { describe, expect, it } from "vitest";

describe("public contract constants", () => {
	it("keeps exported client error vocabulary stable", () => {
		expect(ClientErrorKind.Cancelled).toBe("cancelled");
		expect(ClientErrorKind.Unauthenticated).toBe("unauthenticated");
		expect(ClientErrorSource.Transport).toBe("transport");
		expect(ClientErrorSource.ClientRuntime).toBe("client_runtime");
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
		expect(BackendOidcMediatedModeBootstrapSource.Callback).toBe("callback");
		expect(BackendOidcMediatedModeBootstrapSource.Restore).toBe("restore");
		expect(BackendOidcMediatedModeContextSource.Client).toBe(
			"token_set_context_client",
		);
		expect(BackendOidcMediatedModeContextSource.Persistence).toBe(
			"token-set-context",
		);
		expect(BackendOidcMediatedModeStateRestoreSourceKind.Manual).toBe("manual");
		expect(BackendOidcMediatedModeStateRestoreSourceKind.PersistentStore).toBe(
			"persistent_store",
		);
	});

	it("keeps exported session vocabulary stable", () => {
		expect(SessionContextSource.SessionContext).toBe("session-context");
	});
});
