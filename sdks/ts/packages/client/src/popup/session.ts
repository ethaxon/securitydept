import {
	BehaviorSubject,
	catchError,
	delayWhen,
	distinctUntilChanged,
	exhaustMap,
	filter,
	from,
	map,
	merge,
	of,
	ReplaySubject,
	Subject,
	shareReplay,
	take,
	takeUntil,
	timeout,
	timer,
} from "rxjs";
import { SYMBOL_DISPOSE } from "../compat";
import { ClientError, ClientErrorKind, UserRecovery } from "../errors";
import { type EventStreamTrait } from "../events";
import {
	type JsonRpcClientTrait,
	type JsonRpcNotificationEvent,
	type JsonRpcServerTrait,
} from "../protocol/json-rpc";
import { createAsyncSchedulerWithTimestampProvider } from "../rx";
import { type TimeTrait } from "../scheduling/types";
import { createSignal } from "../signals";
import { PopupErrorCode } from "./errors";

export const PopupSessionControlMethod = {
	Ready: "securitydept.popup.session.ready",
	Ping: "securitydept.popup.session.ping",
	Pong: "securitydept.popup.session.pong",
} as const;

const DEFAULT_READY_TIMEOUT_MS = 10_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15_000;

export interface CreatePopupClientSessionOptions {
	jsonRpc: JsonRpcClientTrait;
	time: TimeTrait;
	closedStream: EventStreamTrait<boolean>;
	readyTimeoutMs?: number;
	heartbeatIntervalMs?: number;
	heartbeatTimeoutMs?: number;
}

export interface CreatePopupServerSessionOptions {
	jsonRpc: JsonRpcServerTrait;
}

export class PopupClientSession {
	readonly failure = createSignal<ClientError | null>(null);
	readonly isActive = createSignal(false);

	private readonly init$ = new ReplaySubject<true>();
	private readonly destroyed = createSignal<boolean>(false);
	private readonly destroyed$ = from(this.destroyed).pipe(
		distinctUntilChanged(),
		filter(Boolean),
		shareReplay(1),
	);

	constructor(options: CreatePopupClientSessionOptions) {
		const timestampScheduler = createAsyncSchedulerWithTimestampProvider(
			options.time,
		);
		const ready$ = new Subject<boolean>();
		const pong$ = new Subject<boolean>();
		const closed$ = from(options.closedStream).pipe(filter(Boolean));

		const ping$ = merge(
			ready$.pipe(filter(Boolean)),
			pong$.pipe(filter(Boolean)),
		).pipe(
			delayWhen(() =>
				timer(
					options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
					timestampScheduler,
				),
			),
		);

		from(this.init$)
			.pipe(
				exhaustMap(() =>
					from(options.jsonRpc.onNotification).pipe(
						filter(function isReadyNotification(event): event is {
							method: typeof PopupSessionControlMethod.Ready;
						} {
							return event.method === PopupSessionControlMethod.Ready;
						}),
						take(1),
						timeout({
							each: options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
							scheduler: timestampScheduler,
						}),
						map(() => true),
						catchError(() => of(false)),
					),
				),
				takeUntil(this.destroyed$),
			)
			.subscribe(ready$);

		ping$
			.pipe(
				exhaustMap(() =>
					from(options.jsonRpc.onNotification).pipe(
						filter(function isPongNotification(event): event is {
							method: typeof PopupSessionControlMethod.Pong;
						} {
							return event.method === PopupSessionControlMethod.Pong;
						}),
						take(1),
						timeout({
							first: options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
							scheduler: timestampScheduler,
						}),
						map(() => true),
						catchError(() => of(false)),
					),
				),
				takeUntil(this.destroyed$),
			)
			.subscribe(pong$);

		merge(
			closed$.pipe(
				map(
					() =>
						new ClientError({
							kind: ClientErrorKind.Authorization,
							code: PopupErrorCode.Closed,
							message:
								"Popup window was closed before completing the login flow.",
							recovery: UserRecovery.RestartFlow,
							source: "popup",
						}),
				),
			),
			ready$.pipe(
				map((success) =>
					!success
						? new ClientError({
								kind: ClientErrorKind.Protocol,
								message:
									"Did not receive ready notification from popup within the expected time.",
								recovery: UserRecovery.RestartFlow,
								source: "popup",
							})
						: null,
				),
			),
			pong$.pipe(
				map((success) =>
					!success
						? new ClientError({
								kind: ClientErrorKind.Protocol,
								message:
									"Did not receive pong notification from popup within the expected time.",
								recovery: UserRecovery.RestartFlow,
								source: "popup",
							})
						: null,
				),
			),
		)
			.pipe(
				takeUntil(this.destroyed$),
				shareReplay({
					bufferSize: 1,
					refCount: false,
				}),
			)
			.subscribe((error) => this.failure.set(error));

		merge(
			closed$.pipe(map(() => false)),
			ready$.pipe(map(Boolean)),
			pong$.pipe(map(Boolean)),
		)
			.pipe(takeUntil(this.destroyed$))
			.subscribe((nextIsActive) => {
				this.isActive.set(nextIsActive);
			});
	}

	init(): void {
		this.init$.next(true);
	}

	dispose(): void {
		this.destroyed.set(true);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

export class PopupServerSession {
	private readonly init$ = new ReplaySubject<true>();
	private readonly destroyed$$ = new BehaviorSubject<boolean>(false);
	private readonly destroyed$ = this.destroyed$$.pipe(
		distinctUntilChanged(),
		filter(Boolean),
		shareReplay(1),
	);

	constructor(options: CreatePopupServerSessionOptions) {
		const ready$ = from(this.init$);
		const ping$ = from(options.jsonRpc.onNotification).pipe(
			filter(function isPing(event) {
				return event.method === PopupSessionControlMethod.Ping;
			}),
		);
		const pong$ = ping$;

		merge(
			ready$.pipe(
				map(function createReadyNotify(): JsonRpcNotificationEvent {
					return {
						method: PopupSessionControlMethod.Ready,
					};
				}),
			),
			pong$.pipe(
				map(function createPongNotify(): JsonRpcNotificationEvent {
					return {
						method: PopupSessionControlMethod.Pong,
					};
				}),
			),
		)
			.pipe(takeUntil(this.destroyed$))
			.subscribe((event) => {
				options.jsonRpc.notify(event.method, event.params);
			});
	}

	init(): void {
		this.init$.next(true);
	}

	dispose(): void {
		this.destroyed$$.next(true);
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}
