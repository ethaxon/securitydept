import { type as defineType } from "arktype";
import { type TracingEvent } from "../types";

export interface TracingSubscriberTrait {
	record(event: TracingEvent): void;
}

export const TracingSubscriberTraitSchema = defineType({
	record: "Function",
});
