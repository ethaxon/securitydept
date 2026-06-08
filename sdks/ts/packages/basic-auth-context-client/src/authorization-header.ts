import {
	ClientError,
	ClientErrorKind,
	encodeUint8ArrayToBase64,
} from "@securitydept/client";

export interface CreateBasicAuthorizationHeaderValueOptions {
	readonly username: string;
	readonly password: string;
}

export function createBasicAuthorizationHeaderValue(
	options: CreateBasicAuthorizationHeaderValueOptions,
): string {
	if (options.username.includes(":")) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			code: "basic_auth.authorization_header.username_contains_colon",
			message: "A Basic authentication username cannot contain a colon.",
			source: "basic_auth",
		});
	}

	return `Basic ${encodeUint8ArrayToBase64(
		new TextEncoder().encode(`${options.username}:${options.password}`),
	)}`;
}
