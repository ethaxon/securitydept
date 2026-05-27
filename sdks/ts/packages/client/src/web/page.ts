import { type as defineType } from "arktype";
import { type EnvironmentValidators } from "../environment/types";
import { type PageLifecycleTrait } from "../page";
import {
	throwValidationClientError,
	validateTraitInput,
	validateWithSchemaSync,
	type WithTraitInputValidator,
} from "../validation";
import {
	createPageResumeSource,
	type PageResumeDocumentTarget,
	type PageResumeWindowTarget,
} from "./events";

export interface PageLifecycleForNativeWebCreateOptions {
	document?: PageResumeDocumentTarget | null;
	window?: PageResumeWindowTarget | null;
}

const PageResumeDocumentTargetSchema = defineType({
	addEventListener: "Function",
	removeEventListener: "Function",
	visibilityState: "string",
});

const PageResumeWindowTargetSchema = defineType({
	addEventListener: "Function",
	removeEventListener: "Function",
});

const PageLifecycleForNativeWebUnavailableProbeSchema = defineType({
	document: "null | undefined",
	window: "null | undefined",
});

const PageLifecycleForNativeWebCreateOptionsSchema = defineType({
	document: PageResumeDocumentTargetSchema.or("null").or("undefined"),
	window: PageResumeWindowTargetSchema.or("null").or("undefined"),
});

export function createPageLifecycleForNativeWeb(
	options: PageLifecycleForNativeWebCreateOptions &
		WithTraitInputValidator<Pick<EnvironmentValidators, "pageLifecycle">> = {},
): PageLifecycleTrait | null {
	const { validators, ...createOptions } = options;
	const global = globalThis as {
		document?: PageResumeDocumentTarget;
		window?: PageResumeWindowTarget;
	};
	const resolvedCreateOptions = {
		document: global.document ?? null,
		window: global.window ?? null,
		...createOptions,
	};
	const unavailableProbeResult = validateWithSchemaSync(
		PageLifecycleForNativeWebUnavailableProbeSchema,
		resolvedCreateOptions,
	);
	if (unavailableProbeResult.success) {
		return null;
	}
	validateTraitInput({
		value: resolvedCreateOptions,
		bundledSchema: PageLifecycleForNativeWebCreateOptionsSchema,
		validator: validators?.pageLifecycle,
		onInvalid: (failure) =>
			throwValidationClientError({
				code: "web.page.invalid_native_web_page_lifecycle_options",
				source: "web",
				messagePrefix:
					"createPageLifecycleForNativeWeb could not validate pageLifecycleForNativeWebCreateOptions",
				failure,
			}),
	});
	const documentTarget = resolvedCreateOptions.document ?? null;
	const windowTarget = resolvedCreateOptions.window ?? null;
	return {
		resume: createPageResumeSource({
			documentTarget,
			windowTarget,
		}),
	};
}
