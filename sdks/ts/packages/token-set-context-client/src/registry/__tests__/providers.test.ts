import {
	createFoundationEnvironment,
	SecuritydeptInjectionToken,
} from "@securitydept/client";
import { describe, expect, it, vi } from "vitest";
import { TOKEN_SET_CLIENT_REGISTRY } from "../contracts/tokens";
import { provideTokenSetClientRegistry } from "../providers";

describe("provideTokenSetClientRegistry", () => {
	it("resolves explicit dependencies before creating registry entries", () => {
		const dependencyToken = new SecuritydeptInjectionToken<{ ready: true }>(
			"REGISTRY_ENTRY_FACTORY_DEPENDENCY",
		);
		const dependency = { ready: true } as const;
		const createClients = vi.fn((_injector, resolvedDependency) => {
			expect(resolvedDependency).toBe(dependency);
			return [];
		});
		const environment = createFoundationEnvironment({
			providers: [
				{ provide: dependencyToken, useValue: dependency },
				...provideTokenSetClientRegistry({
					createClients,
					dependencies: [dependencyToken],
				}),
			],
		});

		const registry = environment.injector.get(TOKEN_SET_CLIENT_REGISTRY);

		expect(createClients).toHaveBeenCalledOnce();
		registry.dispose();
	});
});
