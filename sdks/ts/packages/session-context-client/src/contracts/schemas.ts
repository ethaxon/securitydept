import {
	IdentityPrincipalSchema,
	IdentityPrincipalWireSchema,
} from "@securitydept/client";
import { type as defineType } from "arktype";
import { type SessionInfo } from "../types";

export const SessionInfoSchema = defineType({
	principal: IdentityPrincipalSchema,
	"attributes?": "object",
	"extra?": "object",
}).pipe(
	(input): SessionInfo => ({
		principal: input.principal,
		attributes: input.attributes as Record<string, unknown> | undefined,
		extra: input.extra as Record<string, unknown> | undefined,
	}),
);

export const SessionUserInfoResponseSchema = IdentityPrincipalWireSchema.pipe(
	(principal): SessionInfo => ({ principal }),
);
