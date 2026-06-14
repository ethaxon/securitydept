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

const LABEL_TOKEN = new SecuritydeptInjectionToken<string>("LABEL_TOKEN");

describe("createEnvironmentForReact", () => {
	it("creates a foundation environment with caller providers", () => {
		const provider = {
			provide: LABEL_TOKEN,
			useValue: "react",
		} satisfies SecuritydeptProvider;

		const environment = createEnvironmentForReact({ providers: [provider] });

		expect(environment.injector.get(LABEL_TOKEN)).toBe("react");
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
				},
			},
		});

		expect(environment.router.currentUrl()?.toString()).toBe(
			"https://app.example.com/dashboard",
		);
	});
});
