import { type as defineType } from "arktype";
import { SecuritydeptInjectionToken } from "../injection";

// --- Time capability abstraction ---

export interface TimestampProviderTrait {
	/** Return current epoch milliseconds. */
	now(): number;
}

/** Injectable time capability for host timers and deterministic tests. */
export interface TimeTrait extends TimestampProviderTrait {
	/** Return current epoch milliseconds. */
	setTimeout(handler: () => void, delayMs: number): unknown;
	clearTimeout(handle: unknown): void;
}

export const TimeTraitSchema = defineType({
	now: "Function",
	setTimeout: "Function",
	clearTimeout: "Function",
});

export const TIME_TRAIT_TOKEN = new SecuritydeptInjectionToken<TimeTrait>(
	"TIME_TRAIT_TOKEN",
);

export const IDLE_CALLBACK_TRAIT_TOKEN =
	new SecuritydeptInjectionToken<IdleCallbackTrait | null>(
		"IDLE_CALLBACK_TRAIT_TOKEN",
	);

/** Injectable idle-callback capability for hosts that explicitly support it. */
export interface IdleCallbackTrait {
	requestIdleCallback(callback: () => void): unknown;
	cancelIdleCallback(handle: unknown): void;
}

export const IdleCallbackTraitSchema = defineType({
	requestIdleCallback: "Function",
	cancelIdleCallback: "Function",
});
