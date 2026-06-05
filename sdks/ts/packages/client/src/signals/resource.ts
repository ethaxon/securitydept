import { from } from "rxjs";
import { type ToEventStreamInput } from "../events/interop";
import { mapResource, resourceFromSnapshots, rxResource } from "../rx/resource";
import {
	type ReadableSignalTrait,
	type ResourceSnapshot,
	type ResourceTrait,
} from "./types";

export interface ResourceStreamContext<T, R> {
	readonly request: R;
	readonly previous: ResourceSnapshot<T>;
}

export interface CreateResourceOptions<T, R = undefined> {
	readonly request?: ReadableSignalTrait<R | undefined> | (() => R | undefined);
	readonly stream: (
		context: ResourceStreamContext<T, R>,
	) => ToEventStreamInput<T>;
}

export function createResource<T, R = undefined>(
	options: CreateResourceOptions<T, R>,
): ResourceTrait<T> {
	return rxResource({
		...options,
		stream: (context) => from(options.stream(context)),
	});
}

export { mapResource, resourceFromSnapshots };
