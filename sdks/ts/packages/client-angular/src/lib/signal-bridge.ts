// Angular signal / Observable bridge utilities
//
// Canonical import path:
//   import { bridgeToAngularSignal, signalToObservable } from "@securitydept/client-angular"
//
// These utilities convert SDK-native ReadableSignalTrait values to Angular-native
// primitives (WritableSignal, Observable) so that framework adapter packages
// can surface reactive state using idiomatic Angular APIs.
//
// Owner: @securitydept/client-angular — these are generic framework bridges,
// not token-set-specific utilities. All Angular adapters (basic-auth, session,
// token-set, …) should import from here instead of implementing their own.
//
// Stability: provisional (framework adapter)

import type { WritableSignal } from "@angular/core";
import type { ReadableSignalTrait } from "@securitydept/client";
import { Observable } from "rxjs";

/**
 * Bridge an SDK `ReadableSignalTrait` to an Angular writable signal.
 *
 * Immediately syncs the current value, then subscribes to future changes.
 *
 * @returns Cleanup function that unsubscribes from the SDK signal.
 */
export function bridgeToAngularSignal<T>(
	source: ReadableSignalTrait<T>,
	target: WritableSignal<T>,
): () => void {
	target.set(source.get());
	return source.subscribe(() => {
		target.set(source.get());
	});
}

/**
 * Bridge an SDK `ReadableSignalTrait` to an RxJS Observable.
 *
 * The observable emits the current value immediately on subscribe, then
 * emits whenever the SDK signal value changes. Completes on unsubscribe.
 */
export function signalToObservable<T>(
	source: ReadableSignalTrait<T>,
): Observable<T> {
	return new Observable<T>((subscriber) => {
		subscriber.next(source.get());
		const unsubscribe = source.subscribe(() => {
			subscriber.next(source.get());
		});
		return () => unsubscribe();
	});
}
