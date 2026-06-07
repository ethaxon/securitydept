import { JwtDecodeError, JwtDecodeErrorCode } from "./error";
import { type DecodeJwtPayloadOptions, type JwtClaimsSet } from "./types";

export function decodeJwtPayload(
	jwt: string,
	options: DecodeJwtPayloadOptions = {},
): JwtClaimsSet {
	const label = options.label ?? "JWT";
	const parts = jwt.split(".");
	if (parts.length !== 3) {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidFormat,
			message: `${label} must use compact JWS serialization`,
		});
	}

	const claims = parseBase64UrlJsonObject(parts[1], `${label} payload`);
	validateRegisteredClaimTypes(claims, label);
	return claims;
}

function parseBase64UrlJsonObject(value: string, label: string): JwtClaimsSet {
	let parsed: unknown;
	try {
		parsed = JSON.parse(decodeBase64UrlUtf8(value));
	} catch (cause) {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidPayload,
			message: `${label} must be base64url-encoded JSON`,
			cause,
		});
	}

	if (!isJsonObject(parsed)) {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidPayload,
			message: `${label} must be a JSON object`,
		});
	}
	return parsed;
}

function decodeBase64UrlUtf8(value: string): string {
	const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

function validateRegisteredClaimTypes(
	claims: JwtClaimsSet,
	label: string,
): void {
	if (claims.exp !== undefined && typeof claims.exp !== "number") {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidClaim,
			message: `${label} "exp" claim must be a number`,
		});
	}
	if (claims.iat !== undefined && typeof claims.iat !== "number") {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidClaim,
			message: `${label} "iat" claim must be a number`,
		});
	}
	if (claims.nbf !== undefined && typeof claims.nbf !== "number") {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidClaim,
			message: `${label} "nbf" claim must be a number`,
		});
	}
	if (claims.iss !== undefined && typeof claims.iss !== "string") {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidClaim,
			message: `${label} "iss" claim must be a string`,
		});
	}
	if (
		claims.aud !== undefined &&
		typeof claims.aud !== "string" &&
		!isStringArray(claims.aud)
	) {
		throw new JwtDecodeError({
			code: JwtDecodeErrorCode.InvalidClaim,
			message: `${label} "aud" claim must be a string or string array`,
		});
	}
}

function isJsonObject(value: unknown): value is JwtClaimsSet {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}
