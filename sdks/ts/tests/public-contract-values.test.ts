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
	BackendOidcModeClient,
	BackendOidcModeContextSource,
	relayTokenSetPopupCallbackFromEnvironment,
} from "@securitydept/token-set-context-client/backend-oidc-mode";
import {
	TokenSetAuthSourceKind,
	TokenSetStateRestoreSourceKind,
} from "@securitydept/token-set-context-client/orchestration";
import {
	provideTokenSetClientRegistry,
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
	TokenSetClientRegistry,
	TokenSetClientRegistryEventType,
} from "@securitydept/token-set-context-client/registry";
import { describe, expect, it } from "vitest";

describe("public contract values", () => {
	it("exports canonical error, guard, and auth-source vocabulary", () => {
		expect(ClientErrorKind.Cancelled).toBe("cancelled");
		expect(ClientErrorKind.Unauthenticated).toBe("unauthenticated");
		expect(ClientErrorSource.Transport).toBe("transport");
		expect(UserRecovery.Reauthenticate).toBe("reauthenticate");
		expect(AuthGuardResultKind.Ok).toBe("ok");
		expect(AuthGuardResultKind.Redirect).toBe("redirect");
		expect(AuthGuardRedirectStatus.Found).toBe(302);
		expect(TokenSetAuthSourceKind.RefreshToken).toBe("refresh_token");
		expect(TokenSetStateRestoreSourceKind.PersistentStore).toBe(
			"persistent_store",
		);
		expect(BackendOidcModeContextSource.Client).toBe(
			"backend_oidc_mode_client",
		);
		expect(SessionContextSource.SessionContext).toBe("session-context");
	});

	it("resolves canonical token-set entrypoint exports", () => {
		expect(BackendOidcModeClient).toBeDefined();
		expect(relayTokenSetPopupCallbackFromEnvironment).toBeDefined();
		expect(provideTokenSetClientRegistry).toBeDefined();
		expect(TokenSetClientRegistry).toBeDefined();
		expect(TokenSetClientRegistryEventType.Failed).toBe("failed");
		expect(TOKEN_SET_CLIENT_REGISTRY).toBeDefined();
		expect(TOKEN_SET_CLIENT_REGISTRY_ENTRIES).toBeDefined();
	});
});
