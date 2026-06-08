import { describe, expect, it } from "vitest";
import { decodeBase64ToUint8Array, encodeUint8ArrayToBase64 } from "../base64";

describe("Base64 compatibility", () => {
	it("encodes and decodes byte arrays", () => {
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
		const encoded = encodeUint8ArrayToBase64(bytes);

		expect(encoded).toBe("AAEC/f7/");
		expect(decodeBase64ToUint8Array(encoded)).toEqual(bytes);
	});
});
