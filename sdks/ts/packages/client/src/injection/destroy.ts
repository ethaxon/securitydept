import { type DisposableTrait, SYMBOL_DISPOSE } from "../compat/disposable";
import { createSignal } from "../signals/signal";

export abstract class SecuritydeptDestroyRef implements DisposableTrait {
	abstract readonly destroyed: boolean;
	abstract onDestroy(callback: () => void): () => void;
	abstract dispose(): void;

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

class ManagedSecuritydeptDestroyRef extends SecuritydeptDestroyRef {
	private readonly destroyedSignal = createSignal(false);

	get destroyed(): boolean {
		return this.destroyedSignal.get();
	}

	onDestroy(callback: () => void): () => void {
		if (this.destroyedSignal.get()) {
			callback();
			return () => undefined;
		}

		const subscription = this.destroyedSignal.watchStream().subscribe({
			next: callback,
		});
		return () => {
			subscription.unsubscribe();
		};
	}

	dispose(): void {
		if (this.destroyedSignal.get()) {
			return;
		}

		this.destroyedSignal.set(true);
	}

	destroy(): void {
		this.dispose();
	}
}

export function createSecuritydeptDestroyRef(): SecuritydeptDestroyRef {
	return new ManagedSecuritydeptDestroyRef();
}
