import { describe, expect, it } from "vitest";

const publicSpecifiers = [
	"@securitydept/client",
	"@securitydept/client/web",
	"@securitydept/client-angular",
	"@securitydept/client-react",
	"@securitydept/basic-auth-context-client",
	"@securitydept/basic-auth-context-client-angular",
	"@securitydept/basic-auth-context-client-react",
	"@securitydept/session-context-client",
	"@securitydept/session-context-client-angular",
	"@securitydept/session-context-client-react",
	"@securitydept/token-set-context-client/backend-oidc-mode",
	"@securitydept/token-set-context-client/registry",
	"@securitydept/token-set-context-client-angular",
	"@securitydept/token-set-context-client-react",
	"@securitydept/test-utils",
] as const;

describe("workspace runtime resolution", () => {
	it.each(publicSpecifiers)("resolves %s through package dist", (specifier) => {
		const resolved = import.meta.resolve(specifier);
		expect(new URL(resolved).pathname).toContain("/dist/");
	});
});
