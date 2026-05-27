export abstract class SecuritydeptDestroyRef {
	abstract readonly destroyed: boolean;
	abstract onDestroy(callback: () => void): () => void;
}

class ManagedSecuritydeptDestroyRef extends SecuritydeptDestroyRef {
	private isDestroyed = false;
	private readonly listeners = new Set<() => void>();

	get destroyed(): boolean {
		return this.isDestroyed;
	}

	onDestroy(callback: () => void): () => void {
		if (this.isDestroyed) {
			callback();
			return () => undefined;
		}

		this.listeners.add(callback);
		return () => {
			this.listeners.delete(callback);
		};
	}

	destroy(): void {
		if (this.isDestroyed) {
			return;
		}

		this.isDestroyed = true;
		const listeners = [...this.listeners];
		this.listeners.clear();
		for (const listener of listeners) {
			listener();
		}
	}
}

export function createSecuritydeptDestroyRef(): SecuritydeptDestroyRef {
	return new ManagedSecuritydeptDestroyRef();
}
