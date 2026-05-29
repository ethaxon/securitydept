import { type ResourceRef, type Signal } from "@angular/core";
import {
	type RxResourceOptions,
	rxResource,
	type ToSignalOptions,
	toSignal,
} from "@angular/core/rxjs-interop";
import {
	type InteropObservableTrait,
	SYMBOL_OBSERVABLE,
} from "@securitydept/client";
import { from } from "rxjs";

export type ToNgResourceOptions<T, R> = Omit<RxResourceOptions<T, R>, "stream">;

export function toNgSignal<T>(
	source: InteropObservableTrait<T>,
): Signal<T | undefined>;
export function toNgSignal<T>(
	source: InteropObservableTrait<T>,
	options: NoInfer<ToSignalOptions<T | undefined>> & {
		initialValue?: undefined;
		requireSync?: false;
	},
): Signal<T | undefined>;
export function toNgSignal<T>(
	source: InteropObservableTrait<T>,
	options: NoInfer<ToSignalOptions<T | null>> & {
		initialValue?: null;
		requireSync?: false;
	},
): Signal<T | null>;
export function toNgSignal<T>(
	source: InteropObservableTrait<T>,
	options: NoInfer<ToSignalOptions<T>> & {
		initialValue?: undefined;
		requireSync: true;
	},
): Signal<T>;
export function toNgSignal<T, const U extends T>(
	source: InteropObservableTrait<T>,
	options: NoInfer<ToSignalOptions<T | U>> & {
		initialValue: U;
		requireSync?: false;
	},
): Signal<T | U>;
export function toNgSignal<T>(
	source: InteropObservableTrait<T>,
	options?: ToSignalOptions<T | undefined>,
): Signal<T | undefined> {
	return toSignal(source[SYMBOL_OBSERVABLE](), options as never) as Signal<
		T | undefined
	>;
}

export function toNgResource<T, R = unknown>(
	source: InteropObservableTrait<T>,
	options: ToNgResourceOptions<T, R> & {
		defaultValue: NoInfer<T>;
	},
): ResourceRef<T>;
export function toNgResource<T, R = unknown>(
	source: InteropObservableTrait<T>,
	options?: ToNgResourceOptions<T, R>,
): ResourceRef<T | undefined>;
export function toNgResource<T, R = unknown>(
	source: InteropObservableTrait<T>,
	options: ToNgResourceOptions<T, R> = {},
): ResourceRef<T | undefined> {
	return rxResource({
		...options,
		stream: () => from(source),
	});
}
