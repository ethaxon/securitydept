import { type as defineType } from "arktype";
import { type EventStreamTrait, EventStreamTraitSchema } from "../events/types";
import { SecuritydeptInjectionToken } from "../injection";

export interface PageLifecycleTrait<TResumeEvent = unknown> {
	resume: EventStreamTrait<TResumeEvent>;
}

export const PageLifecycleTraitSchema = defineType({
	resume: EventStreamTraitSchema,
});

export const PAGE_LIFECYCLE_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<PageLifecycleTrait | null>(
		"PAGE_LIFECYCLE_TRAIT_TOKEN",
	);
