import {
	createOnceAsyncLockCallable,
	createSignal,
	readonlySignal,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
	tryInjectInInjectionContext,
} from "@securitydept/client";
import { type BaseOidcModeClient } from "@securitydept/token-set-context-client/orchestration";
import {
	type TokenSetClientRegistry as CoreClientRegistry,
	FrontendOidcModeCallbackController,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeCallbackState,
	type TokenSetClientQueryOptions,
} from "@securitydept/token-set-context-client/registry";
import { type ReactRegistry } from "./token-set-auth-registry";

export interface ReactFrontendOidcModeCallbackInput {
	currentUrl: string;
	clientQuery?: TokenSetClientQueryOptions;
}

export class ReactTokenSetCallbackResumeController {
	private readonly registry: CoreClientRegistry<BaseOidcModeClient>;
	private readonly stateSignal = createSignal<FrontendOidcModeCallbackState>(
		createIdleCallbackLock(),
	);

	readonly state = readonlySignal(this.stateSignal);

	constructor(registry: ReactRegistry) {
		this.registry =
			registry as unknown as CoreClientRegistry<BaseOidcModeClient>;

		tryInjectInInjectionContext(SecuritydeptDestroyRef, {
			optional: true,
		})?.onDestroy(() => this.dispose());
	}

	isCallback(options: ReactFrontendOidcModeCallbackInput): boolean {
		return this.createController(options).isCallback();
	}

	async handle(
		options: ReactFrontendOidcModeCallbackInput,
	): Promise<FrontendOidcModeCallbackResult> {
		const controller = this.createController(options);
		const unsubscribe = controller.state.notify(() => {
			this.stateSignal.set(controller.state.get());
		});
		this.stateSignal.set(controller.state.get());
		try {
			return await controller.handle();
		} finally {
			unsubscribe();
		}
	}

	reset(): void {
		this.stateSignal.set(createIdleCallbackLock());
	}

	dispose(): void {
		this.reset();
	}

	private createController(
		options: ReactFrontendOidcModeCallbackInput,
	): FrontendOidcModeCallbackController {
		return new FrontendOidcModeCallbackController({
			registry: () => this.registry,
			currentUrl: () => options.currentUrl,
			clientQuery: () => options.clientQuery,
		});
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
	if (input instanceof ReactTokenSetCallbackResumeController) {
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

function createIdleCallbackLock(): FrontendOidcModeCallbackState {
	return createOnceAsyncLockCallable(async () => {
		throw new Error(
			"[ReactTokenSetCallbackResumeController] No callback has been started.",
		);
	});
}
