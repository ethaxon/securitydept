import { ReflectiveInjector } from "injection-js";
import { describe, expect, it, vi } from "vitest";
import {
	createProviderIfTokenMissing,
	createSecuritydeptDestroyRef,
	INJECTOR_TOKEN,
	inject,
	runInInjectionContext,
	type SecuritydeptDependencyToken,
	type SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	SecuritydeptInjector,
	type SecuritydeptInjectorTrait,
	tryInjectInInjectionContext,
} from "../index";

const MESSAGE_TOKEN = new SecuritydeptInjectionToken<string>("MESSAGE_TOKEN");
const COUNT_TOKEN = new SecuritydeptInjectionToken<number>("COUNT_TOKEN");
const LOGGER_TOKEN = new SecuritydeptInjectionToken<Logger>("LOGGER_TOKEN");
const FACTORY_TOKEN = new SecuritydeptInjectionToken<string>("FACTORY_TOKEN");
const ALIAS_TOKEN = new SecuritydeptInjectionToken<string>("ALIAS_TOKEN");
const OPTIONAL_TOKEN = new SecuritydeptInjectionToken<string>("OPTIONAL_TOKEN");

class Logger {
	constructor(
		readonly message: string,
		readonly count: number,
	) {}
}

describe("SecuritydeptInjector", () => {
	it("resolves value providers", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "hello" },
		]);

		expect(injector.get(MESSAGE_TOKEN)).toBe("hello");
	});

	it("provides INJECTOR_TOKEN as the concrete SecuritydeptInjector instance", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([]);

		expect(injector.get(INJECTOR_TOKEN)).toBe(injector);
	});

	it("resolves class providers with explicit deps", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "logger" },
			{ provide: COUNT_TOKEN, useValue: 2 },
			{
				provide: LOGGER_TOKEN,
				useClass: Logger,
				deps: [MESSAGE_TOKEN, COUNT_TOKEN],
			},
		]);

		expect(injector.get(LOGGER_TOKEN)).toEqual(new Logger("logger", 2));
	});

	it("resolves factory providers with explicit deps", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "factory" },
			{ provide: COUNT_TOKEN, useValue: 3 },
			{
				provide: FACTORY_TOKEN,
				useFactory: (message: string, count: number) => `${message}:${count}`,
				deps: [MESSAGE_TOKEN, COUNT_TOKEN],
			},
		]);

		expect(injector.get(FACTORY_TOKEN)).toBe("factory:3");
	});

	it("resolves existing-provider aliases", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "alias-target" },
			{ provide: ALIAS_TOKEN, useExisting: MESSAGE_TOKEN },
		]);

		expect(injector.get(ALIAS_TOKEN)).toBe("alias-target");
	});

	it("looks up tokens from parent injectors", () => {
		const parent = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "parent" },
		]);
		const child = SecuritydeptInjector.fromParentInjector(parent, [
			{ provide: COUNT_TOKEN, useValue: 1 },
		]);

		expect(child.get(MESSAGE_TOKEN)).toBe("parent");
		expect(child.get(COUNT_TOKEN)).toBe(1);
	});

	it("looks up tokens from arbitrary SecuritydeptInjectorTrait parents", () => {
		const parentGet = vi.fn(
			(
				token: typeof MESSAGE_TOKEN | typeof OPTIONAL_TOKEN,
				notFoundValue?: string,
			) => {
				if (token === MESSAGE_TOKEN) {
					return "duck-parent";
				}
				if (notFoundValue !== undefined) {
					return notFoundValue as string;
				}
				throw new Error("missing");
			},
		);
		const parent: SecuritydeptInjectorTrait = {
			get: parentGet,
		};
		const child = SecuritydeptInjector.fromParentInjector(parent, [
			{ provide: COUNT_TOKEN, useValue: 4 },
		]);

		expect(child.get(MESSAGE_TOKEN)).toBe("duck-parent");
		expect(child.get(OPTIONAL_TOKEN, "fallback")).toBe("fallback");
		expect(parentGet).toHaveBeenCalled();
	});

	it("allows child injectors to override parent tokens", () => {
		const parent = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "parent" },
		]);
		const child = SecuritydeptInjector.fromParentInjector(parent, [
			{ provide: MESSAGE_TOKEN, useValue: "child" },
		]);

		expect(child.get(MESSAGE_TOKEN)).toBe("child");
		expect(parent.get(MESSAGE_TOKEN)).toBe("parent");
	});

	it("returns notFoundValue when the token is missing", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([]);

		expect(injector.get(OPTIONAL_TOKEN, "fallback")).toBe("fallback");
	});

	it("throws clear securitydept-scoped errors for missing tokens", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([]);

		expect(() => injector.get(OPTIONAL_TOKEN)).toThrowError(
			"[SecuritydeptInjector] No provider found for Token OPTIONAL_TOKEN.",
		);
	});

	it("supports injection-js compatible inject() inside runInInjectionContext()", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "contextual" },
		]);

		expect(runInInjectionContext(injector, () => inject(MESSAGE_TOKEN))).toBe(
			"contextual",
		);
	});

	it("accepts arbitrary SecuritydeptInjectorTrait in runInInjectionContext()", () => {
		class DuckParentInjector implements SecuritydeptInjectorTrait {
			get<T>(token: SecuritydeptDependencyToken<T>): T;
			get<T>(token: SecuritydeptDependencyToken<T>, notFoundValue: T): T;
			get<T>(token: SecuritydeptDependencyToken<T>, ...rest: [] | [T]): T {
				const [notFoundValue] = rest;
				if (token === MESSAGE_TOKEN) {
					return "duck-context" as T;
				}
				if (rest.length === 1) {
					return notFoundValue as T;
				}
				throw new Error("missing");
			}
		}

		const parent = new DuckParentInjector();

		expect(runInInjectionContext(parent, () => inject(MESSAGE_TOKEN))).toBe(
			"duck-context",
		);
	});

	it("accepts raw injection-js ReflectiveInjector parents", () => {
		const parent = ReflectiveInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "runtime-parent" },
		]);
		const child = SecuritydeptInjector.fromParentInjector(parent, [
			{ provide: MESSAGE_TOKEN, useValue: "runtime-child" },
			{ provide: COUNT_TOKEN, useValue: 7 },
		]);

		expect(child.get(MESSAGE_TOKEN)).toBe("runtime-child");
		expect(child.get(COUNT_TOKEN)).toBe(7);
		expect(
			SecuritydeptInjector.fromParentInjector(parent, []).get(MESSAGE_TOKEN),
		).toBe("runtime-parent");
		expect(runInInjectionContext(parent, () => inject(MESSAGE_TOKEN))).toBe(
			"runtime-parent",
		);
	});

	it("supports optional inject() lookups", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([]);

		expect(
			runInInjectionContext(injector, () =>
				inject(OPTIONAL_TOKEN, { optional: true }),
			),
		).toBeNull();
	});

	it("returns null when called outside an injection context", () => {
		expect(tryInjectInInjectionContext(MESSAGE_TOKEN)).toBeNull();
		expect(
			tryInjectInInjectionContext(OPTIONAL_TOKEN, { optional: true }),
		).toBeNull();
	});

	it("still resolves values inside an injection context", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([
			{ provide: MESSAGE_TOKEN, useValue: "contextual" },
		]);

		expect(
			runInInjectionContext(injector, () =>
				tryInjectInInjectionContext(MESSAGE_TOKEN),
			),
		).toBe("contextual");
	});

	it("still rethrows missing provider errors inside an injection context", () => {
		const injector = SecuritydeptInjector.resolveAndCreate([]);

		expect(() =>
			runInInjectionContext(injector, () =>
				tryInjectInInjectionContext(MESSAGE_TOKEN),
			),
		).toThrow(/No provider/);
	});

	it("exposes a destroy ref compatible lifecycle primitive", () => {
		const destroyRef = createSecuritydeptDestroyRef();
		const callback = vi.fn();

		expect(destroyRef.destroyed).toBe(false);
		const unregister = destroyRef.onDestroy(callback);
		unregister();

		const trigger = vi.fn();
		destroyRef.onDestroy(trigger);
		(destroyRef as SecuritydeptDestroyRef & { destroy: () => void }).destroy();

		expect(destroyRef.destroyed).toBe(true);
		expect(callback).not.toHaveBeenCalled();
		expect(trigger).toHaveBeenCalledTimes(1);
	});

	it("creates providers only when the token is missing", () => {
		const createProvider = vi.fn(() => ({
			provide: MESSAGE_TOKEN,
			useValue: "created",
		}));

		expect(
			createProviderIfTokenMissing(new Set(), MESSAGE_TOKEN, createProvider),
		).toEqual({
			provide: MESSAGE_TOKEN,
			useValue: "created",
		});
		expect(createProvider).toHaveBeenCalledTimes(1);
	});

	it("does not create providers when the token already exists", () => {
		const createProvider = vi.fn(() => ({
			provide: MESSAGE_TOKEN,
			useValue: "created",
		}));

		expect(
			createProviderIfTokenMissing(
				new Set([MESSAGE_TOKEN]),
				MESSAGE_TOKEN,
				createProvider,
			),
		).toBeNull();
		expect(createProvider).not.toHaveBeenCalled();
	});
});
