import {
	type CancellationTokenSourceTrait,
	type CancellationTokenTrait,
	type ClientError,
	createCancellationTokenSource,
	createLinkedCancellationToken,
	type DisposableTrait,
	type FoundationEnvironment,
	type ReadableSignalTrait,
	type ResourceSnapshot,
	ResourceSnapshotUpdateKind,
	type ResourceTrait,
	readonlySignal,
	reduceResourceSnapshot,
	resourceFromSnapshots,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import {
	RxStateSignal,
	type RxStateSignalCompat,
} from "@securitydept/client/rx";
import {
	OidcModeCallbackHandlingKind,
	type OidcModeCallbackHandlingResult,
	type OidcModeCallbackInputResolver,
} from "./types";

export interface OidcModeCallbackHandlerOptions<TInput, TResult> {
	readonly environment: FoundationEnvironment;
	readonly rootCancellationToken: CancellationTokenTrait;
	readonly inputResolver: OidcModeCallbackInputResolver<TInput> | null;
	readonly handleInput: (
		input: TInput,
		cancellationToken: CancellationTokenTrait,
	) => Promise<TResult>;
	readonly createInputNotFoundError: () => ClientError;
	readonly normalizeError: (error: unknown) => ClientError;
}

type OidcModeCallbackHandlerExecuteOptions<TInput> =
	| {
			readonly resolveInput: true;
			readonly input?: never;
			readonly cancellationToken?: CancellationTokenTrait;
	  }
	| {
			readonly resolveInput: false;
			readonly input: TInput | null;
			readonly cancellationToken?: CancellationTokenTrait;
	  };

export class OidcModeCallbackHandler<TInput, TResult>
	implements DisposableTrait
{
	private readonly stateSignal: RxStateSignalCompat<
		ResourceSnapshot<OidcModeCallbackHandlingResult<TResult>>
	> = RxStateSignal.fromInitialValue<
		ResourceSnapshot<OidcModeCallbackHandlingResult<TResult>>
	>({ status: "idle" });
	private executor:
		| Promise<OidcModeCallbackHandlingResult<TResult>>
		| undefined;
	private cancellationSource: CancellationTokenSourceTrait | undefined;

	readonly state: ReadableSignalTrait<
		ResourceSnapshot<OidcModeCallbackHandlingResult<TResult>>
	> = readonlySignal(this.stateSignal);
	readonly resource: ResourceTrait<OidcModeCallbackHandlingResult<TResult>> =
		resourceFromSnapshots(() => this.stateSignal.get());

	constructor(
		private readonly options: OidcModeCallbackHandlerOptions<TInput, TResult>,
	) {}

	restore(
		options: { cancellationToken?: CancellationTokenTrait } = {},
	): Promise<OidcModeCallbackHandlingResult<TResult>> {
		return this.execute({
			resolveInput: true,
			cancellationToken: options.cancellationToken,
		});
	}

	async handle(options: {
		input: TInput | null;
		cancellationToken?: CancellationTokenTrait;
	}): Promise<TResult> {
		const outcome = await this.execute({
			input: options.input,
			resolveInput: false,
			cancellationToken: options.cancellationToken,
		});
		if (outcome.kind === OidcModeCallbackHandlingKind.NotApplicable) {
			throw this.options.createInputNotFoundError();
		}
		return outcome.result;
	}

	cancel(): void {
		this.cancellationSource?.cancel();
	}

	dispose(): void {
		this.cancel();
		this.resource.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private execute(
		executeOptions: OidcModeCallbackHandlerExecuteOptions<TInput>,
	): Promise<OidcModeCallbackHandlingResult<TResult>> {
		if (this.executor) {
			return this.executor;
		}

		const cancellationSource = createCancellationTokenSource();
		const cancellationToken = createLinkedCancellationToken(
			this.options.rootCancellationToken,
			cancellationSource.token,
			executeOptions.cancellationToken,
		);
		this.cancellationSource = cancellationSource;
		this.stateSignal.set(
			reduceResourceSnapshot(this.stateSignal.get(), {
				kind: ResourceSnapshotUpdateKind.Load,
			}),
		);

		let executor!: Promise<OidcModeCallbackHandlingResult<TResult>>;
		executor = (async () => {
			try {
				cancellationToken.throwIfCancellationRequested();
				const input = executeOptions.resolveInput
					? await this.options.inputResolver?.({
							environment: this.options.environment,
							cancellationToken,
						})
					: executeOptions.input;
				cancellationToken.throwIfCancellationRequested();

				if (input == null) {
					if (!executeOptions.resolveInput) {
						throw this.options.createInputNotFoundError();
					}
					const result = {
						kind: OidcModeCallbackHandlingKind.NotApplicable,
					} as const;
					this.stateSignal.set(
						reduceResourceSnapshot(this.stateSignal.get(), {
							kind: ResourceSnapshotUpdateKind.Resolve,
							value: result,
						}),
					);
					return result;
				}

				const callbackResult = await this.options.handleInput(
					input,
					cancellationToken,
				);
				cancellationToken.throwIfCancellationRequested();
				const result = {
					kind: OidcModeCallbackHandlingKind.Handled,
					result: callbackResult,
				} as const;
				this.stateSignal.set(
					reduceResourceSnapshot(this.stateSignal.get(), {
						kind: ResourceSnapshotUpdateKind.Resolve,
						value: result,
					}),
				);
				return result;
			} catch (error) {
				const clientError = this.options.normalizeError(error);
				this.stateSignal.set(
					reduceResourceSnapshot(this.stateSignal.get(), {
						kind: ResourceSnapshotUpdateKind.Fail,
						error: clientError,
					}),
				);
				throw clientError;
			} finally {
				if (this.executor === executor) {
					this.executor = undefined;
					this.cancellationSource = undefined;
				}
				cancellationToken.dispose();
			}
		})();
		this.executor = executor;
		return executor;
	}
}
