import { type as defineType } from "arktype";
import { type FrontendOidcModeConfigProjection } from "./contracts";

export const FrontendOidcModeClaimsCheckScriptSchema = defineType({
	type: "'inline'",
	content: "string",
});

export const FrontendOidcModeConfigProjectionSchema = defineType({
	"wellKnownUrl?": "string",
	"issuerUrl?": "string",
	"jwksUri?": "string",
	"metadataRefreshInterval?": "string",
	"jwksRefreshInterval?": "string",
	"authorizationEndpoint?": "string",
	"tokenEndpoint?": "string",
	"userinfoEndpoint?": "string",
	"revocationEndpoint?": "string",
	"tokenEndpointAuthMethodsSupported?": "string[]",
	"idTokenSigningAlgValuesSupported?": "string[]",
	"userinfoSigningAlgValuesSupported?": "string[]",
	clientId: "string > 0",
	"clientSecret?": "string",
	"scopes?": "string[]",
	"requiredScopes?": "string[]",
	redirectUrl: "string > 0",
	"pkceEnabled?": "boolean",
	"claimsCheckScript?": FrontendOidcModeClaimsCheckScriptSchema,
	"generatedAt?": "number",
}).pipe(
	(input): FrontendOidcModeConfigProjection => ({
		...input,
		generatedAt: input.generatedAt ?? 0,
	}),
);
