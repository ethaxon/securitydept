import type { PageLifecycleTrait } from "../../environment/types";
import type { EnvironmentValidators } from "../../environment/validators";
import { validateEnvTraitInput } from "../../environment/validators";
import {
	createPageResumeSource,
	type PageResumeDocumentTarget,
	type PageResumeWindowTarget,
} from "../events";

export interface CreatePageLifecycleForNativeWebOptions {
	document?: PageResumeDocumentTarget | null;
	window?: PageResumeWindowTarget | null;
	validators?: Pick<EnvironmentValidators, "pageLifecycle">;
}

export function createPageLifecycleForNativeWeb(
	options: CreatePageLifecycleForNativeWebOptions = {},
): PageLifecycleTrait {
	const global = globalThis as {
		document?: PageResumeDocumentTarget;
		window?: PageResumeWindowTarget;
	};
	const documentTarget = options.document ?? global.document ?? null;
	const windowTarget = options.window ?? global.window ?? null;
	validateEnvTraitInput({
		traitName: "pageLifecycle",
		hostAdapter: "createPageLifecycleForNativeWeb",
		value: { document: documentTarget, window: windowTarget },
		validator: options.validators?.pageLifecycle,
		bundleValidate: (value) => {
			const input = value as {
				document?: PageResumeDocumentTarget | null;
				window?: PageResumeWindowTarget | null;
			};
			return (
				(input.document === null ||
					input.document === undefined ||
					typeof input.document.addEventListener === "function") &&
				(input.window === null ||
					input.window === undefined ||
					typeof input.window.addEventListener === "function")
			);
		},
	});
	const pageLifecycle: PageLifecycleTrait = {
		resume: createPageResumeSource({
			documentTarget,
			windowTarget,
		}),
	};
	return pageLifecycle;
}
