import {
	ClientError,
	ClientErrorKind,
	formatValidationFailure,
	validateWithSchemaSync,
} from "@securitydept/client";
import {
	SessionContextErrorCode,
	SessionContextSource,
	type SessionInfo,
} from "../types";
import { SessionInfoSchema, SessionUserInfoResponseSchema } from "./schemas";

export function parseSessionInfoPayload(body: unknown): SessionInfo {
	const infoResult = validateWithSchemaSync(SessionInfoSchema, body);
	if (infoResult.success) {
		return infoResult.value;
	}

	const userInfoResult = validateWithSchemaSync(
		SessionUserInfoResponseSchema,
		body,
	);
	if (userInfoResult.success) {
		return userInfoResult.value;
	}

	const failure = {
		success: false as const,
		issues: [...infoResult.issues, ...userInfoResult.issues],
	};
	const issueSummary = formatValidationFailure(failure);
	throw new ClientError({
		kind: ClientErrorKind.Protocol,
		code: SessionContextErrorCode.InvalidSessionPayload,
		message: issueSummary
			? `Session /user-info payload is invalid: ${issueSummary}.`
			: "Session /user-info payload is invalid.",
		source: SessionContextSource.SessionContext,
		cause: failure.issues,
	});
}
