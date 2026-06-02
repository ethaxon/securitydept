import {
	type CompatFragmentParameters,
	ENVIRONMENT_TOKEN,
	type FoundationEnvironment,
	takeCompatFragmentFromRouter,
} from "@securitydept/client";
import {
	useReadableSignalValue,
	useSecuritydeptContext,
} from "@securitydept/client-react";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	BackendOidcModeCallbackController,
	type BackendOidcModeCallbackResult,
	type BackendOidcModeCallbackState,
	type TokenSetClientQueryOptions,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "../client-registry-service";

export interface UseTokenSetBackendCallbackControllerOptions {
	readonly registry?: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly environment?: FoundationEnvironment;
	readonly clientQuery: TokenSetClientQueryOptions;
	readonly autoHandle?: boolean;
}

export interface UseTokenSetBackendCallbackControllerResult {
	readonly controller: BackendOidcModeCallbackController;
	readonly state: BackendOidcModeCallbackState;
	handle(): Promise<BackendOidcModeCallbackResult>;
}

export function useTokenSetBackendCallbackController(
	options: UseTokenSetBackendCallbackControllerOptions,
): UseTokenSetBackendCallbackControllerResult {
	const injector = useSecuritydeptContext();
	const registry =
		options.registry ??
		(injector.get(TOKEN_SET_CLIENT_REGISTRY) as TokenSetClientRegistryService);
	const environment = options.environment ?? injector.get(ENVIRONMENT_TOKEN);
	const payloadRef = useRef<CompatFragmentParameters | undefined>(undefined);
	const clientQueryRef = useRef(options.clientQuery);
	clientQueryRef.current = options.clientQuery;
	const [, setControllerVersion] = useState(0);

	const controller = useMemo(
		() =>
			new BackendOidcModeCallbackController({
				registry: () => registry,
				payload: () => {
					if (!payloadRef.current) {
						throw new Error(
							"[useTokenSetBackendCallbackController] No compat fragment payload is available.",
						);
					}
					return payloadRef.current;
				},
				clientQuery: () => clientQueryRef.current,
			}),
		[registry],
	);
	const state = useReadableSignalValue(controller.state);
	const autoHandle = options.autoHandle ?? true;

	useEffect(() => {
		let cancelled = false;
		const router = environment.router;
		if (!router) {
			return;
		}
		void takeCompatFragmentFromRouter(router).then((compatFragment) => {
			if (cancelled || !compatFragment) {
				return;
			}
			payloadRef.current = compatFragment.parameters;
			controller.reset();
			setControllerVersion((version) => version + 1);
			if (autoHandle) {
				void controller.handle().catch(() => undefined);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [autoHandle, controller, environment.router]);

	return {
		controller,
		state,
		handle: () => controller.handle(),
	};
}
