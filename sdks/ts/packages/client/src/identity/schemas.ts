import { type as defineType } from "arktype";
import { type IdentityPrincipal } from "./contracts";

export const IdentityPrincipalSchema = defineType({
	subject: "string > 0",
	"displayName?": "string | null | undefined",
	"picture?": "string | null | undefined",
	"issuer?": "string | null | undefined",
	"claims?": "object | null | undefined",
}).pipe(
	(input): IdentityPrincipal => ({
		subject: input.subject,
		displayName:
			typeof input.displayName === "string" &&
			input.displayName.trim().length > 0
				? input.displayName
				: input.subject,
		picture: input.picture ?? undefined,
		issuer: input.issuer ?? undefined,
		claims: (input.claims ?? undefined) as Record<string, unknown> | undefined,
	}),
);

export const IdentityPrincipalWireSchema = defineType({
	subject: "string > 0",
	"display_name?": "string | null | undefined",
	"picture?": "string | null | undefined",
	"issuer?": "string | null | undefined",
	"claims?": "object | null | undefined",
}).pipe(
	(input): IdentityPrincipal => ({
		subject: input.subject,
		displayName:
			typeof input.display_name === "string" &&
			input.display_name.trim().length > 0
				? input.display_name
				: input.subject,
		picture: input.picture ?? undefined,
		issuer: input.issuer ?? undefined,
		claims: (input.claims ?? undefined) as Record<string, unknown> | undefined,
	}),
);
