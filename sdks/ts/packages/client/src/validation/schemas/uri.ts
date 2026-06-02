import { type as defineType } from "arktype";
import {
	UriReferenceString,
	UriRelativeString,
	UriString,
} from "../../struct/uri-string";

export const UriStringSchema = defineType("string").narrow((value, context) =>
	UriString.tryParse(value) == null
		? context.reject("an absolute URI string")
		: true,
);

export const BaseURIStringSchema = UriStringSchema;

export const UriRelativeStringSchema = defineType("string").narrow(
	(value, context) =>
		UriRelativeString.tryParse(value) == null
			? context.reject("a relative URI reference string")
			: true,
);

export const UriReferenceStringSchema = defineType("string").narrow(
	(value, context) =>
		UriReferenceString.tryParse(value) == null
			? context.reject("a URI reference string")
			: true,
);
