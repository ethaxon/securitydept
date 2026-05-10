import {
	createSignal,
	type HttpTransport,
	type ReadableSignalTrait,
	readonlySignal,
} from "@securitydept/client";
import type { SessionContextClient } from "./client";
import type { SessionInfo } from "./types";

export const SessionContextControllerStatus = {
	Idle: "idle",
	Loading: "loading",
	Authenticated: "authenticated",
	Unauthenticated: "unauthenticated",
	Error: "error",
} as const;

export type SessionContextControllerStatus =
	(typeof SessionContextControllerStatus)[keyof typeof SessionContextControllerStatus];

export interface SessionContextControllerState {
	status: SessionContextControllerStatus;
	session: SessionInfo | null;
	error: unknown | null;
}

export interface SessionContextControllerOptions {
	client: SessionContextClient;
	transport: HttpTransport;
}

export class SessionContextController {
	readonly client: SessionContextClient;
	readonly state: ReadableSignalTrait<SessionContextControllerState>;

	private readonly transport: HttpTransport;
	private readonly stateSignal = createSignal<SessionContextControllerState>({
		status: SessionContextControllerStatus.Idle,
		session: null,
		error: null,
	});
	private refreshPromise: Promise<SessionInfo | null> | null = null;
	private disposed = false;

	constructor(options: SessionContextControllerOptions) {
		this.client = options.client;
		this.transport = options.transport;
		this.state = readonlySignal(this.stateSignal);
	}

	getState(): SessionContextControllerState {
		return this.stateSignal.get();
	}

	subscribe(listener: () => void): () => void {
		return this.stateSignal.subscribe(listener);
	}

	refresh(): Promise<SessionInfo | null> {
		if (this.disposed) {
			return Promise.resolve(this.stateSignal.get().session);
		}
		if (this.refreshPromise) {
			return this.refreshPromise;
		}

		this.stateSignal.set({
			status: SessionContextControllerStatus.Loading,
			session: this.stateSignal.get().session,
			error: null,
		});

		this.refreshPromise = this.client
			.fetchUserInfo(this.transport)
			.then((session) => {
				if (!this.disposed) {
					this.stateSignal.set({
						status: session
							? SessionContextControllerStatus.Authenticated
							: SessionContextControllerStatus.Unauthenticated,
						session,
						error: null,
					});
				}
				return session;
			})
			.catch((error: unknown) => {
				if (!this.disposed) {
					this.stateSignal.set({
						status: SessionContextControllerStatus.Error,
						session: null,
						error,
					});
				}
				throw error;
			})
			.finally(() => {
				this.refreshPromise = null;
			});

		return this.refreshPromise;
	}

	async rememberPostAuthRedirect(uri: string): Promise<void> {
		await this.client.rememberPostAuthRedirect(uri);
	}

	async clearPostAuthRedirect(): Promise<void> {
		await this.client.clearPostAuthRedirect();
	}

	async resolveLoginUrl(): Promise<string> {
		return await this.client.resolveLoginUrl();
	}

	async logout(): Promise<void> {
		this.stateSignal.set({
			status: SessionContextControllerStatus.Loading,
			session: this.stateSignal.get().session,
			error: null,
		});
		try {
			await this.client.logoutAndClearPendingLoginRedirect(this.transport);
			if (!this.disposed) {
				this.stateSignal.set({
					status: SessionContextControllerStatus.Unauthenticated,
					session: null,
					error: null,
				});
			}
		} catch (error) {
			if (!this.disposed) {
				this.stateSignal.set({
					status: SessionContextControllerStatus.Error,
					session: null,
					error,
				});
			}
			throw error;
		}
	}

	dispose(): void {
		this.disposed = true;
	}
}
