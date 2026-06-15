import { type RefObject, useRef } from "react";

const UNINITIALIZED_REF = Symbol("securitydept.react.uninitialized_ref");

export function useInitialRef<T>(initialize: () => T): RefObject<T> {
	const ref = useRef<T | typeof UNINITIALIZED_REF>(UNINITIALIZED_REF);
	if (ref.current === UNINITIALIZED_REF) {
		ref.current = initialize();
	}
	return ref as RefObject<T>;
}
