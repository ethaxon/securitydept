import {
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
} from "@securitydept/client";
import {
	createEnvironmentForNativeWeb,
	type NativeWebEnvironment,
} from "@securitydept/client/web";
import { describe, expect, it } from "vitest";
import { createEnvironmentForReact } from "../environment";
import { QueryStore } from "../query-store";

const LABEL_TOKEN = new SecuritydeptInjectionToken<string>("LABEL_TOKEN");

describe("createEnvironmentForReact", () => {
	it("creates a foundation environment with caller providers", () => {
		const provider = {
			provide: LABEL_TOKEN,
			useValue: "react",
		} satisfies SecuritydeptProvider;

		const environment = createEnvironmentForReact({ providers: [provider] });

		expect(environment.injector.get(LABEL_TOKEN)).toBe("react");
		expect(environment.injector.get(QueryStore)).toBeInstanceOf(QueryStore);
	});

	it("allows callers to override the environment query store", () => {
		const base = createEnvironmentForReact();
		const queryStore = new QueryStore({ time: base.time });
		const environment = createEnvironmentForReact({
			providers: [{ provide: QueryStore, useValue: queryStore }],
		});

		expect(environment.injector.get(QueryStore)).toBe(queryStore);
	});

	it("composes over a host environment creator", () => {
		const environment: NativeWebEnvironment = createEnvironmentForReact({
			createBaseEnvironment: createEnvironmentForNativeWeb,
			routerForNativeWebCreateOptions: {
				location: {
					href: "https://app.example.com/dashboard",
					hash: "",
					pathname: "/dashboard",
					search: "",
				},
				history: {
					replaceState() {},
					pushState() {},
				},
			},
		});

		expect(environment.router.currentUrl()?.toString()).toBe(
			"https://app.example.com/dashboard",
		);
	});
});
