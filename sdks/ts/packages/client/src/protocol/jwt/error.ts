import { ClientError, ClientErrorKind } from "../../errors";

export const JwtDecodeErrorCode = {
	InvalidFormat: "protocol.jwt.invalid_format",
	InvalidPayload: "protocol.jwt.invalid_payload",
	InvalidClaim: "protocol.jwt.invalid_claim",
} as const;

export type JwtDecodeErrorCode =
	(typeof JwtDecodeErrorCode)[keyof typeof JwtDecodeErrorCode];

export class JwtDecodeError extends ClientError {
	override readonly code: JwtDecodeErrorCode;

	constructor(options: {
		code: JwtDecodeErrorCode;
		message: string;
		cause?: unknown;
	}) {
		super({
			kind: ClientErrorKind.Protocol,
			code: options.code,
			message: options.message,
			source: "protocol.jwt",
			cause: options.cause,
		});
		this.name = "JwtDecodeError";
		this.code = options.code;
	}
}
