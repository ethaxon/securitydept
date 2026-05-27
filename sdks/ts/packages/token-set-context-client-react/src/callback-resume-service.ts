import {
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
	tryInjectInInjectionContext,
} from "@securitydept/client";
import { TokenSetCallbackResumeController as CoreTokenSetCallbackResumeController } from "@securitydept/token-set-context-client/registry";
import { type TokenSetReactClient } from "./contracts";
import { type ReactRegistry } from "./token-set-auth-registry";

export class ReactTokenSetCallbackResumeController extends CoreTokenSetCallbackResumeController<TokenSetReactClient> {
	constructor(registry: ReactRegistry) {
		super({
			registry,
			getCallbackClient: (client) => client,
		});

		tryInjectInInjectionContext(SecuritydeptDestroyRef, {
			optional: true,
		})?.onDestroy(() => this.dispose());
	}
}

export const TOKEN_SET_CALLBACK_RESUME_CONTROLLER =
	new SecuritydeptInjectionToken<ReactTokenSetCallbackResumeController>(
		"TOKEN_SET_CALLBACK_RESUME_CONTROLLER",
	);

export function createTokenSetCallbackResumeController(
	registry: ReactRegistry,
): ReactTokenSetCallbackResumeController {
	return new ReactTokenSetCallbackResumeController(registry);
}

export function provideTokenSetCallbackResumeController(
	registry: ReactRegistry,
): SecuritydeptProvider<ReactTokenSetCallbackResumeController>;
export function provideTokenSetCallbackResumeController(
	controller: ReactTokenSetCallbackResumeController,
): SecuritydeptProvider<ReactTokenSetCallbackResumeController>;
export function provideTokenSetCallbackResumeController(
	input: ReactRegistry | ReactTokenSetCallbackResumeController,
): SecuritydeptProvider<ReactTokenSetCallbackResumeController> {
	if (input instanceof CoreTokenSetCallbackResumeController) {
		return {
			provide: TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
			useValue: input,
		};
	}

	return {
		provide: TOKEN_SET_CALLBACK_RESUME_CONTROLLER,
		useFactory: () => new ReactTokenSetCallbackResumeController(input),
	};
}
