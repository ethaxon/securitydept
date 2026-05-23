/** biome-ignore-all lint/complexity/noBannedTypes: false negative */
import {
	concatAll,
	filter,
	from,
	lastValueFrom,
	map,
	Observable,
	type ObservableInput,
	type Observer,
	type OperatorFunction,
	type Subscription,
	takeLast,
	takeWhile,
	toArray,
} from "rxjs";
import { ClientError, ClientErrorKind } from "../errors";

export const CommandResponseType = {
	Data: "data",
	Success: "success",
	Error: "error",
	Cancel: "cancel",
	Rejected: "rejected",
} as const;

export type CommandResponseType =
	(typeof CommandResponseType)[keyof typeof CommandResponseType];

export type Command<Payload = unknown, Extra extends {} = {}> = Extra & {
	readonly payload: Payload;
};

export type CommandDataResponse<TCmd extends Command, TData = unknown> = {
	readonly type: typeof CommandResponseType.Data;
	readonly command: TCmd;
	readonly data: TData;
};

export type CommandSuccessResponse<TCmd extends Command> = {
	readonly type: typeof CommandResponseType.Success;
	readonly command: TCmd;
};

export type CommandErrorResponse<TCmd extends Command> = {
	readonly type: typeof CommandResponseType.Error;
	readonly command: TCmd;
	readonly error: unknown;
};

export type CommandCancelResponse<TCmd extends Command> = {
	readonly type: typeof CommandResponseType.Cancel;
	readonly command: TCmd;
};

export type CommandRejectedResponse<TCmd extends Command> = {
	readonly type: typeof CommandResponseType.Rejected;
	readonly command: TCmd;
	readonly reason: string;
};

export type CommandTerminalResponse<TCmd extends Command> =
	| CommandSuccessResponse<TCmd>
	| CommandErrorResponse<TCmd>
	| CommandCancelResponse<TCmd>
	| CommandRejectedResponse<TCmd>;

export type CommandResponse<TCmd extends Command, TData = unknown> =
	| CommandDataResponse<TCmd, TData>
	| CommandTerminalResponse<TCmd>;

export interface DispatchCommandBaseOptions<
	TCmd extends Command,
	TData = unknown,
> {
	readonly requestStream: Pick<Observer<TCmd>, "next">;
	readonly responseStream: ObservableInput<CommandResponse<TCmd, TData>>;
}

export interface DispatchCommandLocallyOptions<
	TPayload,
	TCommandExtra extends {} = {},
	TData = unknown,
	TCmd extends Command<TPayload, TCommandExtra> = Command<
		TPayload,
		TCommandExtra
	>,
> extends DispatchCommandBaseOptions<TCmd, TData> {
	readonly payload: TPayload;
	readonly createCommandExtra?: (payload: TPayload) => TCommandExtra;
}

export interface DispatchCommandByIdOptions<
	TCmd extends Command,
	TId,
	TData = unknown,
> extends DispatchCommandBaseOptions<TCmd, TData> {
	readonly command: TCmd;
	readonly selectCommandId: (command: TCmd) => TId;
	readonly areIdsEqual?: (left: TId, right: TId) => boolean;
}

function createCommandCancellationError<TCmd extends Command>(
	command: TCmd,
): Error {
	return new ClientError({
		kind: ClientErrorKind.Cancelled,
		message: "Command was cancelled before completion",
		cause: {
			command,
		},
	});
}

function createCommandRejectedError<TCmd extends Command>(
	command: TCmd,
	reason: string,
): Error {
	return new ClientError({
		kind: ClientErrorKind.Cancelled,
		message: `Command was rejected before execution: ${reason}`,
		cause: {
			command,
			reason,
		},
	});
}

export function isCommandDataResponse<TCmd extends Command, TData>(
	response: CommandResponse<TCmd, TData>,
): response is CommandDataResponse<TCmd, TData> {
	return response.type === CommandResponseType.Data;
}

export function isCommandTerminalResponse<TCmd extends Command, TData>(
	response: CommandResponse<TCmd, TData>,
): response is CommandTerminalResponse<TCmd> {
	return response.type !== CommandResponseType.Data;
}

function dispatchCommand<TCmd extends Command, TData>(
	dispatch: () => void,
	matches: (response: CommandResponse<TCmd, TData>) => boolean,
): OperatorFunction<
	CommandResponse<TCmd, TData>,
	CommandResponse<TCmd, TData>
> {
	return (source$) =>
		new Observable<CommandResponse<TCmd, TData>>((subscriber) => {
			const subscription = source$
				.pipe(filter(matches), takeWhile(isCommandDataResponse, true))
				.subscribe(subscriber);

			if (subscription.closed) {
				return subscription;
			}

			try {
				dispatch();
			} catch (error) {
				if (!subscription.closed) {
					subscriber.error(error);
				}
			}

			return subscription;
		});
}

export function unwrapCommandTerminalResponse<TCmd extends Command>(
	response: CommandTerminalResponse<TCmd>,
): void {
	switch (response.type) {
		case CommandResponseType.Success:
			return;
		case CommandResponseType.Error:
			throw response.error;
		case CommandResponseType.Cancel:
			throw createCommandCancellationError(response.command);
		case CommandResponseType.Rejected:
			throw createCommandRejectedError(response.command, response.reason);
	}
}

export function commandResponseData<
	TCmd extends Command,
	TData,
>(): OperatorFunction<CommandResponse<TCmd, TData>, TData> {
	return (source$) =>
		source$.pipe(
			filter((response): response is CommandDataResponse<TCmd, TData> => {
				if (isCommandDataResponse(response)) {
					return true;
				}

				unwrapCommandTerminalResponse(response);
				return false;
			}),
			map((response) => response.data),
		);
}

export function dispatchCommandLocallyToStream<
	TPayload,
	TCommandExtra extends {} = {},
	TData = unknown,
	TCmd extends Command<TPayload, TCommandExtra> = Command<
		TPayload,
		TCommandExtra
	>,
>(
	options: DispatchCommandLocallyOptions<TPayload, TCommandExtra, TData, TCmd>,
): Observable<CommandResponse<TCmd, TData>> {
	const command = {
		payload: options.payload,
		...(options.createCommandExtra?.(options.payload) ?? {}),
	} as TCmd;

	return from(options.responseStream).pipe(
		dispatchCommand(
			() => {
				options.requestStream.next(command);
			},
			(response) => response.command === command,
		),
	);
}

export function dispatchCommandByIdToStream<
	TCmd extends Command,
	TId,
	TData = unknown,
>(
	options: DispatchCommandByIdOptions<TCmd, TId, TData>,
): Observable<CommandResponse<TCmd, TData>> {
	const areIdsEqual = options.areIdsEqual ?? Object.is;
	const commandId = options.selectCommandId(options.command);

	return from(options.responseStream).pipe(
		dispatchCommand(
			() => {
				options.requestStream.next(options.command);
			},
			(response) =>
				areIdsEqual(options.selectCommandId(response.command), commandId),
		),
	);
}

export async function dispatchCommandLocallyToPromise<
	TPayload,
	TCommandExtra extends {} = {},
	TData = unknown,
	TCmd extends Command<TPayload, TCommandExtra> = Command<
		TPayload,
		TCommandExtra
	>,
>(
	options: DispatchCommandLocallyOptions<
		TPayload,
		TCommandExtra,
		TData,
		TCmd
	> & {},
): Promise<CommandDataResponse<TCmd, TData>> {
	const [data, terminal] = await lastValueFrom(
		dispatchCommandLocallyToStream(options).pipe(takeLast(2), toArray()),
		{
			defaultValue: [],
		},
	);
	if (!isCommandDataResponse(data)) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			message:
				"the executor configuration of dispatchCommandLocallyToPromise should produce a valid data response.",
		});
	}
	if (!isCommandTerminalResponse(terminal)) {
		throw new ClientError({
			kind: ClientErrorKind.Unreachable,
			message:
				"the execution of dispatchCommandLocallyToPromise must produce a valid terminal response.",
		});
	}
	unwrapCommandTerminalResponse(terminal);
	return data;
}

export async function dispatchCommandByIdToPromise<
	TCmd extends Command,
	TId,
	TData = unknown,
>(
	options: DispatchCommandByIdOptions<TCmd, TId, TData>,
): Promise<CommandDataResponse<TCmd, TData>> {
	const [data, terminal] = await lastValueFrom(
		dispatchCommandByIdToStream(options).pipe(takeLast(2), toArray()),
		{
			defaultValue: [],
		},
	);
	if (!isCommandDataResponse(data)) {
		throw new ClientError({
			kind: ClientErrorKind.Configuration,
			message:
				"the executor configuration of dispatchCommandLocallyToPromise should produce a valid data response.",
		});
	}
	if (!isCommandTerminalResponse(terminal)) {
		throw new ClientError({
			kind: ClientErrorKind.Unreachable,
			message:
				"the execution of dispatchCommandLocallyToPromise must produce a valid terminal response.",
		});
	}
	unwrapCommandTerminalResponse(terminal);
	return data;
}

function createCommandExecutionStream<
	TCmd extends Command,
	TData = unknown,
>(options: {
	readonly command: TCmd;
	readonly execute: (command: TCmd) => ObservableInput<TData>;
	readonly onStateEnd?: (command: TCmd) => void;
}): Observable<CommandResponse<TCmd, TData>> {
	return new Observable<CommandResponse<TCmd, TData>>((subscriber) => {
		let didEmitTerminal = false;

		const emitTerminal = (response: CommandTerminalResponse<TCmd>) => {
			if (didEmitTerminal) {
				return;
			}

			didEmitTerminal = true;
			subscriber.next(response);
			subscriber.complete();
		};

		const subscription = from(options.execute(options.command)).subscribe({
			next: (data) => {
				subscriber.next({
					type: CommandResponseType.Data,
					command: options.command,
					data,
				});
			},
			error: (error) => {
				emitTerminal({
					type: CommandResponseType.Error,
					command: options.command,
					error,
				});
			},
			complete: () => {
				emitTerminal({
					type: CommandResponseType.Success,
					command: options.command,
				});
			},
		});

		return () => {
			const wasTerminalEmitted = didEmitTerminal;
			subscription.unsubscribe();
			options.onStateEnd?.(options.command);

			if (!wasTerminalEmitted) {
				subscriber.next({
					type: CommandResponseType.Cancel,
					command: options.command,
				});
			}
		};
	});
}

export function switchCommand<TCmd extends Command, TData = unknown>(
	execute: (command: TCmd) => ObservableInput<TData>,
): OperatorFunction<TCmd, CommandResponse<TCmd, TData>> {
	return (source$) =>
		new Observable<CommandResponse<TCmd, TData>>((destination) => {
			let innerSubscription: Subscription | null = null;
			let currentCommand: TCmd | null = null;
			let isComplete = false;

			const checkComplete = () => {
				if (isComplete && !innerSubscription) {
					destination.complete();
				}
			};

			const sourceSubscription = source$.subscribe({
				next: (command) => {
					const cancelledCommand = currentCommand;

					innerSubscription?.unsubscribe();
					innerSubscription = null;
					currentCommand = null;

					if (cancelledCommand) {
						destination.next({
							type: CommandResponseType.Cancel,
							command: cancelledCommand,
						});
					}

					currentCommand = command;
					let didCompleteSynchronously = false;
					const nextInnerSubscription = createCommandExecutionStream({
						command,
						execute,
					}).subscribe({
						next: (response) => {
							destination.next(response);
						},
						error: (error) => {
							destination.error(error);
						},
						complete: () => {
							didCompleteSynchronously = true;
							innerSubscription = null;
							currentCommand = null;
							checkComplete();
						},
					});

					if (!didCompleteSynchronously) {
						innerSubscription = nextInnerSubscription;
					}
				},
				error: (error) => {
					destination.error(error);
				},
				complete: () => {
					isComplete = true;
					checkComplete();
				},
			});

			return () => {
				sourceSubscription.unsubscribe();
				innerSubscription?.unsubscribe();
			};
		});
}

export function concatCommand<TCmd extends Command, TData = unknown>(
	execute: (command: TCmd) => ObservableInput<TData>,
): OperatorFunction<TCmd, CommandResponse<TCmd, TData>> {
	return (source$: Observable<TCmd>) =>
		source$.pipe(
			map((command) =>
				createCommandExecutionStream({
					command,
					execute,
				}),
			),
			concatAll(),
		);
}

export const exhaustCommand =
	<TCmd extends Command, TData = unknown>(
		execute: (command: TCmd) => ObservableInput<TData>,
	) =>
	(source$: Observable<TCmd>) =>
		new Observable<CommandResponse<TCmd, TData>>((destination) => {
			let innerSubscription: Subscription | null = null;
			let isComplete = false;

			const checkComplete = () => {
				if (isComplete && !innerSubscription) {
					destination.complete();
				}
			};

			const sourceSubscription = source$.subscribe({
				next: (command) => {
					if (innerSubscription) {
						destination.next({
							type: CommandResponseType.Rejected,
							command,
							reason: "Pessimistic lock active.",
						});
						return;
					}

					let didCompleteSynchronously = false;
					const nextInnerSubscription = createCommandExecutionStream({
						command,
						execute,
					}).subscribe({
						next: (response) => {
							destination.next(response);
						},
						error: (error) => {
							destination.error(error);
						},
						complete: () => {
							didCompleteSynchronously = true;
							innerSubscription = null;
							checkComplete();
						},
					});

					if (!didCompleteSynchronously) {
						innerSubscription = nextInnerSubscription;
					}
				},
				error: (error) => {
					destination.error(error);
				},
				complete: () => {
					isComplete = true;
					checkComplete();
				},
			});

			return () => {
				sourceSubscription.unsubscribe();
				innerSubscription?.unsubscribe();
			};
		});
