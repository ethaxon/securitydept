import { type DisposableTrait, SYMBOL_DISPOSE } from "../compat/disposable";
import { createReplaySignal } from "../signals/replay-signal";

export abstract class SecuritydeptDestroyRef implements DisposableTrait {
	abstract readonly destroyed: boolean;
	abstract onDestroy(callback: () => void): () => void;
	abstract dispose(): void;

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}
}

class ManagedSecuritydeptDestroyRef extends SecuritydeptDestroyRef {
	private readonly destroyedSignal = createReplaySignal<void>();

	get destroyed(): boolean {
		return this.destroyedSignal.hasValue();
	}

	onDestroy(callback: () => void): () => void {
		if (this.destroyedSignal.hasValue()) {
			callback();
			return () => undefined;
		}

		return this.destroyedSignal.notify(callback);
	}

	dispose(): void {
		if (this.destroyedSignal.hasValue()) {
			return;
		}

		this.destroyedSignal.setValue(undefined);
	}

	destroy(): void {
		this.dispose();
	}
}

export function createSecuritydeptDestroyRef(): SecuritydeptDestroyRef {
	return new ManagedSecuritydeptDestroyRef();
}
