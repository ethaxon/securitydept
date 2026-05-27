// Angular writable signal bridge utilities
//
// Canonical import path:
//   import { bridgeToAngularSignal } from "@securitydept/client-angular"
//
// These utilities convert SDK-native ReadableSignalTrait values to Angular-native
// writable signals so that framework adapter packages can surface reactive
// state using idiomatic Angular APIs.
//
// Owner: @securitydept/client-angular — this package owns Angular-specific
// writable signal bridging only. The canonical framework-neutral RxJS bridge
// lives in @securitydept/client/rx.
//
// Stability: provisional (framework adapter)

import { type WritableSignal } from "@angular/core";
import { type ReadableSignalTrait } from "@securitydept/client";

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
