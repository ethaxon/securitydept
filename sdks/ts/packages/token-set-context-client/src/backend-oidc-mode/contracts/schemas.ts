import { type as defineType } from "arktype";
import {
	type BackendOidcModeCallbackReturns,
	type BackendOidcModeRefreshReturns,
} from "./contracts";

export const BackendOidcModeCallbackBodySchema = defineType({
	access_token: "string",
	id_token: "string",
	"refresh_token?": "string | null",
	"access_token_expires_at?": "string | null",
	"metadata_redemption_id?": "string | null",
}).pipe(
	(input): BackendOidcModeCallbackReturns => ({
		accessToken: input.access_token,
		idToken: input.id_token,
		refreshToken: input.refresh_token ?? undefined,
		expiresAt: input.access_token_expires_at ?? undefined,
		metadataRedemptionId: input.metadata_redemption_id ?? undefined,
	}),
);

export const BackendOidcModeRefreshBodySchema = defineType({
	access_token: "string",
	"id_token?": "string | null",
	"refresh_token?": "string | null",
	"access_token_expires_at?": "string | null",
	"metadata_redemption_id?": "string | null",
}).pipe(
	(input): BackendOidcModeRefreshReturns => ({
		accessToken: input.access_token,
		idToken: input.id_token ?? undefined,
		refreshToken: input.refresh_token ?? undefined,
		expiresAt: input.access_token_expires_at ?? undefined,
		metadataRedemptionId: input.metadata_redemption_id ?? undefined,
	}),
);
