export const AUTH_MODE_STORAGE_KEY = "securitydept.webui.auth_context_mode";

export interface AuthModeStore {
	read(): string | null;
	write(value: string): void;
	clear(): void;
	subscribe(listener: () => void): () => void;
}

export interface NativeWebAuthModeStoreOptions {
	readonly key: string;
	readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
	readonly eventTarget: Pick<
		Window,
		"addEventListener" | "removeEventListener"
	>;
}

export class NativeWebAuthModeStore implements AuthModeStore {
	constructor(private readonly options: NativeWebAuthModeStoreOptions) {}

	read(): string | null {
		return this.options.storage.getItem(this.options.key);
	}

	write(value: string): void {
		this.options.storage.setItem(this.options.key, value);
	}

	clear(): void {
		this.options.storage.removeItem(this.options.key);
	}

	subscribe(listener: () => void): () => void {
		const handleStorage = (event: StorageEvent) => {
			if (event.key === null || event.key === this.options.key) {
				listener();
			}
		};
		this.options.eventTarget.addEventListener("storage", handleStorage);
		return () => {
			this.options.eventTarget.removeEventListener("storage", handleStorage);
		};
	}
}
