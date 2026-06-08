import { ClientError, ClientErrorKind } from "../errors";

export const Base64CompatErrorCode = {
	EncoderUnavailable: "compat.base64.encoder_unavailable",
	DecoderUnavailable: "compat.base64.decoder_unavailable",
} as const;

export type Base64CompatErrorCode =
	(typeof Base64CompatErrorCode)[keyof typeof Base64CompatErrorCode];

type Uint8ArrayConstructorWithBase64 = typeof Uint8Array & {
	readonly prototype: Uint8Array & {
		toBase64?: () => string;
	};
	fromBase64?: (value: string) => Uint8Array;
};

interface BufferConstructorLike {
	from(value: Uint8Array): { toString(encoding: "base64"): string };
	from(value: string, encoding: "base64"): Uint8Array;
}

export function encodeUint8ArrayToBase64(value: Uint8Array): string {
	const Uint8ArrayConstructor =
		globalThis.Uint8Array as Uint8ArrayConstructorWithBase64;
	const toBase64 = Uint8ArrayConstructor.prototype.toBase64;
	if (typeof toBase64 === "function") {
		return toBase64.call(value);
	}

	if (typeof globalThis.btoa === "function") {
		let binary = "";
		for (const byte of value) {
			binary += String.fromCharCode(byte);
		}
		return globalThis.btoa(binary);
	}

	const BufferConstructor = Reflect.get(globalThis, "Buffer") as
		| BufferConstructorLike
		| undefined;
	if (typeof BufferConstructor?.from === "function") {
		return BufferConstructor.from(value).toString("base64");
	}

	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		code: Base64CompatErrorCode.EncoderUnavailable,
		message: "The current realm does not provide a Base64 encoder.",
		source: "compat.base64",
	});
}

export function decodeBase64ToUint8Array(value: string): Uint8Array {
	const Uint8ArrayConstructor =
		globalThis.Uint8Array as Uint8ArrayConstructorWithBase64;
	if (typeof Uint8ArrayConstructor.fromBase64 === "function") {
		return Uint8ArrayConstructor.fromBase64(value);
	}

	if (typeof globalThis.atob === "function") {
		const binary = globalThis.atob(value);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	}

	const BufferConstructor = Reflect.get(globalThis, "Buffer") as
		| BufferConstructorLike
		| undefined;
	if (typeof BufferConstructor?.from === "function") {
		return Uint8ArrayConstructor.from(BufferConstructor.from(value, "base64"));
	}

	throw new ClientError({
		kind: ClientErrorKind.Configuration,
		code: Base64CompatErrorCode.DecoderUnavailable,
		message: "The current realm does not provide a Base64 decoder.",
		source: "compat.base64",
	});
}
