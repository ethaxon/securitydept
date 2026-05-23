import type {
	FoundationEnvironment,
	RouterTrait,
	TelemetryTrait,
} from "../environment/types";
import type { EnvironmentValidators } from "../environment/validators";
import { validateEnvTraitInput } from "../environment/validators";
import { createInMemoryRecordStore } from "../persistence/memory-store";
import type { StorageTrait } from "../persistence/types";
import type { TimeTrait } from "../scheduling/types";
import type { SpanContextHostTrait } from "../span/types";
import { createTelemetryForStd } from "../std/index";
import type { BaseTransportTrait } from "../transport/types";

export interface TestTimeTrait extends TimeTrait {
	advance(ms: number): void;
	flush(): void;
	advanceAndFlush(ms: number): void;
	get pendingCount(): number;
}

export interface CreateTimeForTestOptions {
	initialNow?: number;
	validators?: Pick<EnvironmentValidators, "time">;
}

export function createTimeForTest(
	options: CreateTimeForTestOptions = {},
): TestTimeTrait {
	validateEnvTraitInput({
		traitName: "time",
		hostAdapter: "createTimeForTest",
		value: options,
		validator: options.validators?.time,
		bundleValidate: (value) => {
			const input = value as CreateTimeForTestOptions;
			return (
				input.initialNow === undefined || typeof input.initialNow === "number"
			);
		},
	});
	let now = options.initialNow ?? 0;
	let nextId = 1;
	const tasks = new Map<number, { at: number; handler: () => void }>();
	return {
		now: () => now,
		setTimeout(handler, delayMs) {
			const id = nextId++;
			tasks.set(id, { at: now + Math.max(0, delayMs), handler });
			return id;
		},
		clearTimeout(handle) {
			if (typeof handle === "number") {
				tasks.delete(handle);
			}
		},
		advance(ms) {
			now += ms;
		},
		flush() {
			let progressed = true;
			while (progressed) {
				progressed = false;
				const ready = [...tasks.entries()]
					.filter(([, task]) => task.at <= now)
					.sort((a, b) => a[1].at - b[1].at);
				for (const [id, task] of ready) {
					tasks.delete(id);
					task.handler();
					progressed = true;
				}
			}
		},
		advanceAndFlush(ms) {
			this.advance(ms);
			this.flush();
		},
		get pendingCount() {
			return tasks.size;
		},
	};
}

export interface CreateTelemetryForTestOptions {
	spanContext?: SpanContextHostTrait;
	validators?: Pick<EnvironmentValidators, "telemetry">;
}

export function createTelemetryForTest(
	options: CreateTelemetryForTestOptions = {},
): TelemetryTrait {
	return createTelemetryForStd({
		spanContext: options.spanContext,
		validators: options.validators,
	});
}

export interface CreateStorageForTestOptions {
	initialEntries?: Record<string, string>;
	validators?: Pick<
		EnvironmentValidators,
		"persistentStorage" | "sessionStorage"
	>;
	validatorKey?: "persistentStorage" | "sessionStorage";
}

export function createStorageForTest(
	options: CreateStorageForTestOptions = {},
): StorageTrait {
	const validatorKey = options.validatorKey ?? "persistentStorage";
	validateEnvTraitInput({
		traitName: validatorKey,
		hostAdapter: "createStorageForTest",
		value: options,
		validator: options.validators?.[validatorKey],
		bundleValidate: (value) => {
			const input = value as CreateStorageForTestOptions;
			return (
				input.initialEntries === undefined ||
				(typeof input.initialEntries === "object" &&
					input.initialEntries !== null)
			);
		},
	});
	const storage = createInMemoryRecordStore();
	for (const [key, value] of Object.entries(options.initialEntries ?? {})) {
		void storage.set(key, value);
	}
	return storage;
}

export interface CreateEnvironmentForTestOptions {
	transport?: BaseTransportTrait;
	time?: TimeTrait;
	router?: RouterTrait;
	persistentStorage?: StorageTrait;
	sessionStorage?: StorageTrait;
	spanContext?: SpanContextHostTrait;
	telemetry?: TelemetryTrait;
	validators?: EnvironmentValidators;
}

export function createEnvironmentForTest(
	options: CreateEnvironmentForTestOptions = {},
): FoundationEnvironment {
	const time =
		options.time ??
		createTimeForTest({
			validators: options.validators,
		});
	return {
		transport: options.transport ?? createNullTransport(),
		time,
		persistentStorage:
			options.persistentStorage ??
			createStorageForTest({
				validators: options.validators,
				validatorKey: "persistentStorage",
			}),
		sessionStorage:
			options.sessionStorage ??
			createStorageForTest({
				validators: options.validators,
				validatorKey: "sessionStorage",
			}),
		spanContext: options.spanContext,
		telemetry:
			options.telemetry ??
			createTelemetryForTest({
				spanContext: options.spanContext,
				validators: options.validators,
			}),
		router: options.router,
	};
}

function createNullTransport(): BaseTransportTrait {
	return {
		async execute() {
			throw new Error("Test environment transport was not provided.");
		},
	};
}
