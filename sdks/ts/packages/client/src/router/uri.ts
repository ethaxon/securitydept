import { type as defineType } from "arktype";
import { UriString } from "../struct/uri-string";

export const BaseURIStringSchema = defineType("string").pipe((value) => {
	if (UriString.tryParse(value) == null) {
		throw new TypeError("baseURI must be an absolute URI string");
	}
	return value;
});
