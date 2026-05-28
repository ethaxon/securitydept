import {
	type ValidationFailure,
	validateWithSchemaSync,
} from "@securitydept/client";
import {
	type AuthSnapshot,
	AuthSourceKind,
} from "../../orchestration/token/types";
import {
	type FrontendOidcModeClientConfig,
	type FrontendOidcModeTokenResult,
} from "../client/types";
import {
	configProjectionToClientConfig,
	type FrontendOidcModeConfigProjection,
} from "./contracts";
import { FrontendOidcModeConfigProjectionSchema } from "./schemas";

export function validateConfigProjection(input: unknown) {
	return validateWithSchemaSync(FrontendOidcModeConfigProjectionSchema, input);
}

export function parseConfigProjection(
	input: unknown,
	overrides?: Partial<
		Pick<
			FrontendOidcModeClientConfig,
			"redirectUri" | "defaultPostAuthRedirectUri"
		>
	>,
): { success: true; value: FrontendOidcModeClientConfig } | ValidationFailure {
	const validationResult = validateConfigProjection(input);
	if (!validationResult.success) {
		return validationResult;
	}
	return {
		success: true,
		value: configProjectionToClientConfig(
			validationResult.value as FrontendOidcModeConfigProjection,
			overrides,
		),
	};
}

export function tokenResultToAuthSnapshot(
	result: FrontendOidcModeTokenResult,
	options?: {
		providerId?: string;
		issuer?: string;
	},
): AuthSnapshot {
	return {
		tokens: {
			accessToken: result.accessToken,
			idToken: result.idToken,
			refreshMaterial: result.refreshToken,
			accessTokenExpiresAt: result.expiresAt,
		},
		metadata: {
			source: {
				kind: AuthSourceKind.OidcAuthorizationCode,
				providerId: options?.providerId,
				issuer: options?.issuer,
				kindHistory: [AuthSourceKind.OidcAuthorizationCode],
			},
		},
	};
}
