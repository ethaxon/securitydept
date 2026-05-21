import {
	type ClientEnvironment,
	createBrowserPageClientEnvironment,
	createWebClientEnvironment,
	deriveClientEnvironment,
	type PageClientEnvironment,
	type WebClientEnvironment,
} from "./client-environment";

type MaybePromise<T> = T | Promise<T>;

interface EnvironmentServiceState<T> {
	generation: number;
	hasValue: boolean;
	value: T | null;
	hasError: boolean;
	error: unknown;
	pending: Promise<T> | null;
}

function createEnvironmentServiceState<T>(): EnvironmentServiceState<T> {
	return {
		generation: 0,
		hasValue: false,
		value: null,
		hasError: false,
		error: undefined,
		pending: null,
	};
}

export interface ClientEnvironmentServiceOptions<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
> {
	createClientEnvironment?: () => MaybePromise<TClientEnvironment>;
	createWebEnvironment?: (
		clientEnvironment: TClientEnvironment,
	) => MaybePromise<TWebEnvironment>;
	createPageEnvironment?: (
		webEnvironment: TWebEnvironment,
	) => MaybePromise<TPageEnvironment>;
}

/**
 * Framework-neutral environment resolver with layered lazy materialization.
 *
 * `resolve*()` coalesces concurrent work into a single pending promise.
 * `read*()` is Suspense-compatible: pending resolutions throw the same promise,
 * rejections throw the cached error, and fulfilled layers return the value.
 *
 * `reset()` invalidates all cached layers. In-flight promises may still settle
 * for existing awaiters, but their results are discarded and never repopulate
 * the service cache after a reset.
 */
export class ClientEnvironmentService<
	TClientEnvironment extends ClientEnvironment = ClientEnvironment,
	TWebEnvironment extends WebClientEnvironment = WebClientEnvironment,
	TPageEnvironment extends PageClientEnvironment = PageClientEnvironment,
> {
	private readonly createClientEnvironmentImpl: () => MaybePromise<TClientEnvironment>;
	private readonly createWebEnvironmentImpl: (
		clientEnvironment: TClientEnvironment,
	) => MaybePromise<TWebEnvironment>;
	private readonly createPageEnvironmentImpl: (
		webEnvironment: TWebEnvironment,
	) => MaybePromise<TPageEnvironment>;

	private readonly clientState =
		createEnvironmentServiceState<TClientEnvironment>();
	private readonly webState = createEnvironmentServiceState<TWebEnvironment>();
	private readonly pageState =
		createEnvironmentServiceState<TPageEnvironment>();

	constructor(
		options: ClientEnvironmentServiceOptions<
			TClientEnvironment,
			TWebEnvironment,
			TPageEnvironment
		> = {},
	) {
		this.createClientEnvironmentImpl =
			options.createClientEnvironment ??
			(() => createWebClientEnvironment() as TClientEnvironment);
		this.createWebEnvironmentImpl =
			options.createWebEnvironment ??
			((clientEnvironment) => clientEnvironment as unknown as TWebEnvironment);
		this.createPageEnvironmentImpl =
			options.createPageEnvironment ??
			((webEnvironment) =>
				createBrowserPageClientEnvironment({
					...deriveClientEnvironment(webEnvironment),
				}) as TPageEnvironment);
	}

	resolveClientEnvironment(): Promise<TClientEnvironment> {
		return this.resolveState(this.clientState, () =>
			this.createClientEnvironmentImpl(),
		);
	}

	resolveWebEnvironment(): Promise<TWebEnvironment> {
		return this.resolveState(this.webState, async () =>
			this.createWebEnvironmentImpl(await this.resolveClientEnvironment()),
		);
	}

	resolvePageEnvironment(): Promise<TPageEnvironment> {
		return this.resolveState(this.pageState, async () =>
			this.createPageEnvironmentImpl(await this.resolveWebEnvironment()),
		);
	}

	readClientEnvironment(): TClientEnvironment {
		return this.readState(this.clientState, () =>
			this.resolveClientEnvironment(),
		);
	}

	readWebEnvironment(): TWebEnvironment {
		return this.readState(this.webState, () => this.resolveWebEnvironment());
	}

	readPageEnvironment(): TPageEnvironment {
		return this.readState(this.pageState, () => this.resolvePageEnvironment());
	}

	reset(): void {
		this.resetState(this.clientState);
		this.resetState(this.webState);
		this.resetState(this.pageState);
	}

	private resolveState<T>(
		state: EnvironmentServiceState<T>,
		materialize: () => MaybePromise<T>,
	): Promise<T> {
		if (state.hasValue) {
			return Promise.resolve(state.value as T);
		}

		if (state.hasError) {
			return Promise.reject(state.error);
		}

		if (state.pending) {
			return state.pending;
		}

		const generation = state.generation;
		const pending = Promise.resolve()
			.then(materialize)
			.then(
				(value) => {
					if (state.generation === generation) {
						state.value = value;
						state.hasValue = true;
						state.hasError = false;
						state.error = undefined;
						state.pending = null;
					}

					return value;
				},
				(error) => {
					if (state.generation === generation) {
						state.hasError = true;
						state.error = error;
						state.pending = null;
					}

					throw error;
				},
			);

		state.pending = pending;
		return pending;
	}

	private readState<T>(
		state: EnvironmentServiceState<T>,
		resolve: () => Promise<T>,
	): T {
		if (state.hasValue) {
			return state.value as T;
		}

		if (state.hasError) {
			throw state.error;
		}

		throw resolve();
	}

	private resetState<T>(state: EnvironmentServiceState<T>): void {
		state.generation += 1;
		state.hasValue = false;
		state.value = null;
		state.hasError = false;
		state.error = undefined;
		state.pending = null;
	}
}
