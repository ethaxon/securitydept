import {
	ClientError,
	ClientErrorKind,
	type DisposableTrait,
	type EventStreamTrait,
	type ResourceSnapshot,
	ResourceStatus,
	type ResourceTrait,
	resourceFromSnapshots,
	StorageChangeEventOrigin,
	type StorageTrait,
	SYMBOL_DISPOSE,
} from "@securitydept/client";
import { RxEventSubject, RxStateSignal } from "@securitydept/client/rx";
import {
	catchError,
	concatMap,
	defer,
	EMPTY,
	filter,
	from,
	map,
	take,
	takeUntil,
} from "rxjs";
import { AuthContextMode } from "./model";

export const AUTH_MODE_STORAGE_KEY = "securitydept.webui.auth_context_mode";

const AUTH_MODE_STORE_ERROR_SOURCE = "webui.auth_mode_store";

export const AuthModeStoreErrorCode = {
	PersistenceReadFailed: "webui.auth_mode.persistence_read_failed",
	PersistenceWriteFailed: "webui.auth_mode.persistence_write_failed",
	PersistenceRemoveFailed: "webui.auth_mode.persistence_remove_failed",
	InvalidStoredMode: "webui.auth_mode.invalid_stored_mode",
} as const;

export type AuthModeStoreErrorCode =
	(typeof AuthModeStoreErrorCode)[keyof typeof AuthModeStoreErrorCode];

export interface AuthModeStore extends DisposableTrait {
	readonly mode: ResourceTrait<AuthContextMode | null>;
	readonly errors: EventStreamTrait<ClientError>;
	set(mode: AuthContextMode): void;
	clear(): void;
}

export interface CreateAuthModeStoreOptions {
	readonly key?: string;
	readonly persistentStorage?: StorageTrait;
}

type PersistenceCommand =
	| { readonly kind: "set"; readonly value: AuthContextMode }
	| { readonly kind: "remove" };

class StorageBackedAuthModeStore implements AuthModeStore {
	private readonly key: string;
	private readonly persistentStorage?: StorageTrait;
	private readonly modeSnapshot = RxStateSignal.fromInitialValue<
		ResourceSnapshot<AuthContextMode | null>
	>({ status: ResourceStatus.Loading });
	private readonly modeResource = resourceFromSnapshots<AuthContextMode | null>(
		() => this.modeSnapshot.get(),
	);
	private readonly errorSubject = new RxEventSubject<ClientError>();
	private readonly persistenceCommand =
		new RxEventSubject<PersistenceCommand>();
	private readonly _destroyed = RxStateSignal.fromInitialValue(false);
	private readonly destroyed$ = from(this._destroyed).pipe(
		filter((value): value is true => value),
		take(1),
	);

	readonly mode = this.modeResource;
	readonly errors = this.errorSubject.asObservable();

	constructor(options: CreateAuthModeStoreOptions) {
		this.key = options.key ?? AUTH_MODE_STORAGE_KEY;
		this.persistentStorage = options.persistentStorage;
		this.persistenceCommand
			.pipe(
				concatMap((command) =>
					defer(() => {
						if (!this.persistentStorage) {
							return EMPTY;
						}
						const result =
							command.kind === "set"
								? this.persistentStorage.set(this.key, command.value)
								: this.persistentStorage.remove(this.key);
						return result === undefined ? EMPTY : from(result);
					}).pipe(
						catchError((error) => {
							this.errorSubject.next(
								this.storageError({
									error,
									code:
										command.kind === "set"
											? AuthModeStoreErrorCode.PersistenceWriteFailed
											: AuthModeStoreErrorCode.PersistenceRemoveFailed,
									message:
										command.kind === "set"
											? "Could not persist the selected authentication mode"
											: "Could not remove the persisted authentication mode",
								}),
							);
							return EMPTY;
						}),
					),
				),
				takeUntil(this.destroyed$),
			)
			.subscribe();
		if (this.persistentStorage?.storageEvent) {
			from(this.persistentStorage.storageEvent)
				.pipe(
					filter(
						(event) =>
							event.origin === StorageChangeEventOrigin.External &&
							(event.key === null || event.key === this.key),
					),
					concatMap((event) =>
						from(this.mode.whenValue()).pipe(map(() => event)),
					),
					takeUntil(this.destroyed$),
				)
				.subscribe((event) => {
					this.applyExternalValue(event.newValue);
				});
		}
		void this.hydrate();
	}

	set(mode: AuthContextMode): void {
		this.mode.value.get();
		this.modeSnapshot.set({ status: ResourceStatus.Resolved, value: mode });
		if (this.persistentStorage) {
			this.persistenceCommand.next({ kind: "set", value: mode });
		}
	}

	clear(): void {
		this.mode.value.get();
		this.modeSnapshot.set({ status: ResourceStatus.Resolved, value: null });
		if (this.persistentStorage) {
			this.persistenceCommand.next({ kind: "remove" });
		}
	}

	dispose(): void {
		this._destroyed.set(true);
		this.errorSubject.complete();
		this.modeResource.dispose();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private async hydrate(): Promise<void> {
		if (!this.persistentStorage) {
			this.modeSnapshot.set({ status: ResourceStatus.Resolved, value: null });
			return;
		}

		try {
			const persistedValue = await this.persistentStorage.get(this.key);
			if (persistedValue === null) {
				this.modeSnapshot.set({ status: ResourceStatus.Resolved, value: null });
				return;
			}
			const persistedMode = parseAuthContextMode(persistedValue);
			if (persistedMode === null) {
				this.errorSubject.next(invalidStoredModeError(persistedValue));
				this.persistenceCommand.next({ kind: "remove" });
				this.modeSnapshot.set({ status: ResourceStatus.Resolved, value: null });
				return;
			}
			this.modeSnapshot.set({
				status: ResourceStatus.Resolved,
				value: persistedMode,
			});
		} catch (error) {
			await Promise.resolve();
			this.errorSubject.next(
				this.storageError({
					error,
					code: AuthModeStoreErrorCode.PersistenceReadFailed,
					message: "Could not restore the persisted authentication mode",
				}),
			);
			this.modeSnapshot.set({ status: ResourceStatus.Resolved, value: null });
		}
	}

	private applyExternalValue(raw: string | null): void {
		const mode = raw === null ? null : parseAuthContextMode(raw);
		if (raw !== null && mode === null) {
			this.errorSubject.next(invalidStoredModeError(raw));
		}
		this.modeSnapshot.set({ status: ResourceStatus.Resolved, value: mode });
	}

	private storageError(options: {
		error: unknown;
		code: AuthModeStoreErrorCode;
		message: string;
	}): ClientError {
		return options.error instanceof ClientError &&
			options.error.kind === ClientErrorKind.Storage
			? options.error
			: new ClientError({
					kind: ClientErrorKind.Storage,
					code: options.code,
					message: options.message,
					source: AUTH_MODE_STORE_ERROR_SOURCE,
					cause: options.error,
				});
	}
}

export function createAuthModeStore(
	options: CreateAuthModeStoreOptions,
): AuthModeStore {
	return new StorageBackedAuthModeStore(options);
}

function parseAuthContextMode(raw: string): AuthContextMode | null {
	return raw === AuthContextMode.Session ||
		raw === AuthContextMode.TokenSetBackend ||
		raw === AuthContextMode.TokenSetFrontend ||
		raw === AuthContextMode.Basic
		? raw
		: null;
}

function invalidStoredModeError(raw: string): ClientError {
	return new ClientError({
		kind: ClientErrorKind.Protocol,
		code: AuthModeStoreErrorCode.InvalidStoredMode,
		message: `The stored authentication mode is invalid: ${raw}`,
		source: AUTH_MODE_STORE_ERROR_SOURCE,
	});
}
