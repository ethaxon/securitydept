import {
	ENVIRONMENT_TOKEN,
	type FoundationEnvironment,
} from "@securitydept/client";
import { useSecuritydeptContext, useSignal } from "@securitydept/client-react";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	FrontendOidcModeCallbackController,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeCallbackState,
	type TokenSetClientQueryOptions,
	type TokenSetClientRegistry,
} from "@securitydept/token-set-context-client/registry";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	type TokenSetClientRegistryService,
} from "../client-registry-service";

export interface UseTokenSetFrontendCallbackControllerOptions {
	readonly registry?: TokenSetClientRegistry<BaseOidcModeClient>;
	readonly environment?: FoundationEnvironment;
	readonly clientQuery?: TokenSetClientQueryOptions;
	readonly currentUrl?: string | null | undefined;
	readonly autoHandle?: boolean;
}

export interface UseTokenSetFrontendCallbackControllerResult {
	readonly controller: FrontendOidcModeCallbackController;
	readonly state: FrontendOidcModeCallbackState;
	readonly isCallback: boolean;
	handle(): Promise<FrontendOidcModeCallbackResult>;
}

export function useTokenSetFrontendCallbackController(
	options: UseTokenSetFrontendCallbackControllerOptions = {},
): UseTokenSetFrontendCallbackControllerResult {
	const injector = useSecuritydeptContext();
	const registry =
		options.registry ??
		(injector.get(TOKEN_SET_CLIENT_REGISTRY) as TokenSetClientRegistryService);
	const environment = options.environment ?? injector.get(ENVIRONMENT_TOKEN);
	const clientQueryRef = useRef(options.clientQuery);
	const currentUrlRef = useRef<string | null | undefined>(undefined);
	clientQueryRef.current = options.clientQuery;
	currentUrlRef.current =
		options.currentUrl ?? environment.router?.currentUrl()?.toString();
	const [, setControllerVersion] = useState(0);

	const controller = useMemo(
		() =>
			new FrontendOidcModeCallbackController({
				registry: () => registry,
				currentUrl: () => currentUrlRef.current,
				clientQuery: () => clientQueryRef.current,
			}),
		[registry],
	);
	const state = useSignal(controller.state);
	const isCallback = controller.isCallback();
	const autoHandle = options.autoHandle ?? true;
	const currentUrl = currentUrlRef.current;
	const clientQuery = clientQueryRef.current;

	useEffect(() => {
		void currentUrl;
		void clientQuery;
		if (!autoHandle) {
			return;
		}
		if (!controller.isCallback()) {
			controller.reset();
			setControllerVersion((version) => version + 1);
			return;
		}
		void controller.handle().catch(() => undefined);
	}, [autoHandle, clientQuery, controller, currentUrl]);

	return {
		controller,
		state,
		isCallback,
		handle: () => controller.handle(),
	};
}
