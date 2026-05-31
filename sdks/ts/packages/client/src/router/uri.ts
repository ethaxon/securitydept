import { type as defineType } from "arktype";
import { UriReferenceString, UriString } from "../struct/uri-string";

export const BaseURIStringSchema = defineType("string").narrow(
	(value, context) =>
		UriString.tryParse(value) == null
			? context.reject("an absolute URI string")
			: true,
);

export const UriReferenceStringSchema = defineType("string").narrow(
	(value, context) =>
		UriReferenceString.tryParse(value) == null
			? context.reject("a URI reference string")
			: true,
);
