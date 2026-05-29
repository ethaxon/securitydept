import { ClientError, ClientErrorKind } from "../errors";
import {
	formatValidationFailure,
	type ValidationFailure,
	validateWithSchemaSync,
} from "../validation";
import {
	type IdentityPrincipal,
	type ProjectIdentityPrincipalOptions,
} from "./contracts";
import {
	IdentityPrincipalSchema,
	IdentityPrincipalWireSchema,
} from "./schemas";

function throwIdentityPrincipalParseError(options: {
	code: string;
	messagePrefix: string;
	failure: ValidationFailure;
}): never {
	throw new ClientError({
		kind: ClientErrorKind.Protocol,
		code: options.code,
		message: `${options.messagePrefix}: ${formatValidationFailure(options.failure) ?? "schema validation failed"}.`,
		source: "identity",
		cause: options.failure.issues,
	});
}

export function parseIdentityPrincipal(input: unknown): IdentityPrincipal {
	const result = validateWithSchemaSync(IdentityPrincipalSchema, input);
	if (result.success) {
		return result.value;
	}
	throwIdentityPrincipalParseError({
		code: "identity.invalid_principal",
		messagePrefix: "Identity principal payload is invalid",
		failure: result,
	});
}

export function parseIdentityPrincipalWire(input: unknown): IdentityPrincipal {
	const result = validateWithSchemaSync(IdentityPrincipalWireSchema, input);
	if (result.success) {
		return result.value;
	}
	throwIdentityPrincipalParseError({
		code: "identity.invalid_principal_wire",
		messagePrefix: "Identity principal wire payload is invalid",
		failure: result,
	});
}

export function projectIdentityPrincipal(
	options: ProjectIdentityPrincipalOptions,
): IdentityPrincipal {
	const principal = options.principal;
	const subject =
		principal?.subject ?? options.fallbackSubject ?? "context.anonymous";
	const displayName =
		principal?.displayName?.trim() || options.fallbackDisplayName || subject;

	return {
		subject,
		displayName,
		picture: principal?.picture,
		issuer: principal?.issuer ?? options.fallbackIssuer,
		claims: principal?.claims ?? options.fallbackClaims,
	};
}
