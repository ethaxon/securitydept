import {
	createOnceAsyncLockCallable,
	createSignal,
	type DisposableTrait,
	readonlySignal,
	SecuritydeptDestroyRef,
	SecuritydeptInjectionToken,
	type SecuritydeptProvider,
	tryInjectInInjectionContext,
} from "@securitydept/client";
import {
	type ClientRegistry as CoreClientRegistry,
	FrontendOidcModeCallbackController,
	type FrontendOidcModeCallbackInput,
	type FrontendOidcModeCallbackResult,
	type FrontendOidcModeCallbackState,
} from "@securitydept/token-set-context-client/registry";
import { type ReactRegistry } from "./token-set-auth-registry";

export class ReactTokenSetCallbackResumeController {
	private readonly registry: CoreClientRegistry<DisposableTrait>;
	private readonly stateSignal = createSignal<FrontendOidcModeCallbackState>(
		createIdleCallbackLock(),
	);

	readonly state = readonlySignal(this.stateSignal);

	constructor(registry: ReactRegistry) {
		this.registry = registry as unknown as CoreClientRegistry<DisposableTrait>;

		tryInjectInInjectionContext(SecuritydeptDestroyRef, {
			optional: true,
		})?.onDestroy(() => this.dispose());
	}

	isCallback(options: FrontendOidcModeCallbackInput): boolean {
		return this.createController(options).isCallback();
	}

	async handle(
		options: FrontendOidcModeCallbackInput,
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
		options: FrontendOidcModeCallbackInput,
	): FrontendOidcModeCallbackController {
		return new FrontendOidcModeCallbackController({
			registry: this.registry,
			currentUrl: options.currentUrl,
			clientQuery: options.clientQuery,
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
