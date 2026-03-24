import type { Codec } from "./types";

/** Default JSON codec. */
export function createJsonCodec<T>(): Codec<T> {
	return {
		encode(value: T): string {
			return JSON.stringify(value);
		},
		decode(raw: string): T {
			return JSON.parse(raw) as T;
		},
	};
}
