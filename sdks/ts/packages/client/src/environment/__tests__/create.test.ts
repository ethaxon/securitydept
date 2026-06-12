import { describe, expect, it, vi } from "vitest";
import { SYMBOL_DISPOSE } from "../../compat";
import { ClientError, ClientErrorKind } from "../../errors";
import { createEventSubject } from "../../events";
import {
	INJECTOR_TOKEN,
	type SecuritydeptFactoryProvider,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "../../injection";
import { POPUP_TRAIT_TOKEN, type PopupTrait } from "../../popup";
import { TIME_TRAIT_TOKEN, type TimeTrait } from "../../scheduling/types";
import { createSignal } from "../../signals";
import { createRootSpan } from "../../span";
import {
	createInMemoryRecordStore,
	REALM_STORAGE_TRAIT_TOKEN,
} from "../../storage";
import { createTracing } from "../../tracing";
import { createFoundationEnvironment } from "../create";
import { ENVIRONMENT_TOKEN, type FoundationEnvironment } from "../types";

describe("createFoundationEnvironment()", () => {
	it("fills foundation defaults including transport", () => {
		vi.stubGlobal("fetch", vi.fn());

		const environment = createFoundationEnvironment({});

		expect(environment.injector.get(ENVIRONMENT_TOKEN)).toBe(environment);
		expect(environment.injector.get(INJECTOR_TOKEN)).toBe(environment.injector);
		expect(typeof environment.transport.execute).toBe("function");
		expect(environment.time.now()).toBeTypeOf("number");
		expect(typeof environment.time.setTimeout).toBe("function");
		expect(typeof environment.time.clearTimeout).toBe("function");
		expect(environment.injector.get(TIME_TRAIT_TOKEN)).toBe(environment.time);
		expect(environment.injector.get(REALM_STORAGE_TRAIT_TOKEN)).toBe(
			environment.realmStorage,
		);
		expect(typeof environment.realmStorage.take).toBe("function");
		expect(environment.injector.get(POPUP_TRAIT_TOKEN)).toBeNull();
		expect(environment.span.parent).toBeUndefined();
		expect(typeof environment.tracing.record).toBe("function");
		expect(typeof environment.tracing.events.subscribe).toBe("function");
	});

	it("creates isolated realm storage for each environment", async () => {
		const first = createFoundationEnvironment({});
		const second = createFoundationEnvironment({});

		await first.realmStorage.set("flow", "first");

		await expect(first.realmStorage.get("flow")).resolves.toBe("first");
		await expect(second.realmStorage.get("flow")).resolves.toBeNull();
		expect(first.realmStorage).not.toBe(second.realmStorage);
	});

	it("accepts realm storage option and provider overrides", () => {
		const optionStorage = createInMemoryRecordStore();
		const providerStorage = createInMemoryRecordStore();

		const fromOption = createFoundationEnvironment({
			realmStorage: optionStorage,
		});
		const fromProvider = createFoundationEnvironment({
			realmStorage: optionStorage,
			providers: [
				{
					provide: REALM_STORAGE_TRAIT_TOKEN,
					useValue: providerStorage,
				},
			],
		});

		expect(fromOption.realmStorage).toBe(optionStorage);
		expect(fromProvider.realmStorage).toBe(providerStorage);
	});

	it("resolves root span and tracing from constructor options", () => {
		const subscriber = {
			record: vi.fn(),
		};
		const environment = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 204, headers: {} })),
			},
			spanCreateOptions: {
				idFactory: () => "test_root_span",
			},
			tracingCreateOptions: {
				subscribers: [subscriber],
			},
		});

		environment.tracing.record({
			name: "test.event",
			at: environment.time.now(),
			span: environment.span,
			level: "info",
			target: "test",
		});

		expect(environment.span.id).toBe("test_root_span");
		expect(subscriber.record).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "test.event",
				span: environment.span,
			}),
		);
	});

	it("resolves transport from std fetch constructor options", async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		);
		const environment = createFoundationEnvironment({
			transportForStdFetchCreateOptions: {
				fetch: fetchSpy,
				baseUrl: "https://api.example.com",
			},
		});

		const response = await environment.transport.execute({
			url: "/resource",
			method: "GET",
			headers: {},
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://api.example.com/resource",
			expect.objectContaining({
				method: "GET",
			}),
		);
		expect(response.body).toEqual({ ok: true });
	});

	it("ignores unused fallback inputs when final traits are provided explicitly", () => {
		const explicitTime = {
			now: () => 123,
			setTimeout: vi.fn(),
			clearTimeout: vi.fn(),
		};
		const explicitSpan = createRootSpan();
		const explicitTracing = createTracing();

		const environment = createFoundationEnvironment({
			transport: {
				execute: vi.fn(async () => ({ status: 204, headers: {} })),
			},
			transportForStdFetchCreateOptions: {
				redirect: "broken",
			} as never,
			time: explicitTime,
			timeForStdCreateOptions: null as never,
			span: explicitSpan,
			spanCreateOptions: {
				idFactory: "broken",
			} as never,
			tracing: explicitTracing,
			tracingCreateOptions: {
				subscribers: [{}],
			} as never,
		});

		expect(environment.time).toBe(explicitTime);
		expect(environment.injector.get(TIME_TRAIT_TOKEN)).toBe(explicitTime);
		expect(environment.span).toBe(explicitSpan);
		expect(environment.tracing).toBe(explicitTracing);
	});

	it("allows custom providers to resolve built-in trait dependencies", () => {
		const observedTimes: TimeProviderCapture[] = [];
		const popup = createPopupTraitForTest();
		const explicitTime = {
			now: () => 123,
			setTimeout: vi.fn(),
			clearTimeout: vi.fn(),
		};
		const popupProvider: SecuritydeptFactoryProvider<PopupTrait | null> = {
			provide: POPUP_TRAIT_TOKEN,
			useFactory: ((time: TimeTrait) => {
				observedTimes.push({ now: time.now() });
				return popup;
			}) as (...deps: never[]) => PopupTrait | null,
			deps: [TIME_TRAIT_TOKEN],
		};
		const environment = createFoundationEnvironment({
			time: explicitTime,
			providers: [popupProvider] satisfies readonly SecuritydeptProvider[],
		});

		expect(environment.popup).toBe(popup);
		expect(observedTimes).toHaveLength(1);
		expect(observedTimes[0]?.now).toBe(123);
	});

	it("does not create built-in providers when an external provider owns the same token", () => {
		const popup = createPopupTraitForTest();
		const popupProvider: SecuritydeptFactoryProvider<PopupTrait | null> = {
			provide: POPUP_TRAIT_TOKEN,
			useFactory: (() => popup) as (...deps: never[]) => PopupTrait | null,
		};
		const environment = createFoundationEnvironment({
			popup: {
				open() {
					throw new Error("fallback popup should not be used");
				},
				attach() {
					throw new Error("fallback popup should not be used");
				},
			},
			providers: [popupProvider] satisfies readonly SecuritydeptProvider[],
		});

		expect(environment.popup).toBe(popup);
	});

	it("rejects external ENVIRONMENT_TOKEN providers", () => {
		expect(() =>
			createFoundationEnvironment({
				providers: [
					{
						provide: ENVIRONMENT_TOKEN,
						useFactory: (() => {
							throw new Error("reserved provider should not run");
						}) as (...deps: never[]) => FoundationEnvironment,
					},
				],
			}),
		).toThrow(/does not allow overriding ENVIRONMENT_TOKEN/);
	});

	it("keeps custom dynamic traits injector-only by default", () => {
		const CUSTOM_TOKEN = new SecuritydeptInjectionToken<string>("CUSTOM_TOKEN");
		const customProvider: SecuritydeptFactoryProvider<string> = {
			provide: CUSTOM_TOKEN,
			useFactory: ((time: TimeTrait) => `custom:${time.now()}`) as (
				...deps: never[]
			) => string,
			deps: [TIME_TRAIT_TOKEN],
		};
		const environment = createFoundationEnvironment({
			providers: [customProvider],
		});

		expect(environment.injector.get(CUSTOM_TOKEN)).toMatch(/^custom:/);
		expect("CUSTOM_TOKEN" in environment).toBe(false);
		expect(
			(environment as unknown as Record<string, unknown>).CUSTOM_TOKEN,
		).toBeUndefined();
	});

	it("rejects invalid transport traits", () => {
		expect(() =>
			createFoundationEnvironment({
				transport: {} as never,
			}),
		).toThrow(/could not validate transport/);
	});

	it("rejects invalid realm storage traits", () => {
		expect(() =>
			createFoundationEnvironment({
				realmStorage: {} as never,
			}),
		).toThrow(/could not validate realmStorage/);
	});

	it("rejects invalid explicit span traits", () => {
		expect(() =>
			createFoundationEnvironment({
				transport: {
					execute: vi.fn(async () => ({ status: 204, headers: {} })),
				},
				span: {
					id: "broken",
					parent: undefined,
					attributes: null,
					fork: () => createRootSpan(),
				} as never,
				tracing: createTracing(),
			}),
		).toThrow(/could not validate span/);
	});

	it("rejects invalid root span constructor options with schema issues", () => {
		expect(() =>
			createFoundationEnvironment({
				transport: {
					execute: vi.fn(async () => ({ status: 204, headers: {} })),
				},
				spanCreateOptions: {
					idFactory: "broken",
				} as never,
			}),
		).toThrow(/spanCreateOptions/);
	});

	it("rejects invalid tracing constructor options with schema issues", () => {
		expect(() =>
			createFoundationEnvironment({
				transport: {
					execute: vi.fn(async () => ({ status: 204, headers: {} })),
				},
				tracingCreateOptions: {
					subscribers: [{}],
				} as never,
			}),
		).toThrow(/tracingCreateOptions/);
	});
});

interface TimeProviderCapture {
	now: number;
}

function createPopupTraitForTest(): PopupTrait {
	return {
		attach() {
			return {
				kind: "failure",
				reason: "missing_opener",
				error: new ClientError({
					kind: ClientErrorKind.Configuration,
					message: "attach unavailable",
				}),
			};
		},
		open() {
			const onNotification = createEventSubject();
			return {
				onNotification,
				failure: createSignal<ClientError | null>(null),
				isActive: createSignal(false),
				notify: vi.fn(async () => undefined),
				request: vi.fn(async () => undefined),
				dispose() {
					return undefined;
				},
				[SYMBOL_DISPOSE]() {
					return undefined;
				},
				close() {
					return undefined;
				},
				messaging: {
					outgoing: {
						subscribe: vi.fn(),
						next: vi.fn(),
						error: vi.fn(),
						complete: vi.fn(),
						[Symbol.observable]: vi.fn(),
					} as never,
					incoming: {
						subscribe: vi.fn(),
						[Symbol.observable]: vi.fn(),
					} as never,
				},
			};
		},
	} as PopupTrait;
}
