import {
	createSignal,
	type DisposableTrait,
	type ReadableSignalTrait,
	readonlySignal,
	SYMBOL_DISPOSE,
	type WritableSignalTrait,
} from "@securitydept/client";

export const ThemePreference = {
	System: "system",
	Light: "light",
	Dark: "dark",
} as const;

export type ThemePreference =
	(typeof ThemePreference)[keyof typeof ThemePreference];

type ResolvedThemePreference =
	| typeof ThemePreference.Light
	| typeof ThemePreference.Dark;

export interface ThemeServiceHost {
	readonly window: Pick<Window, "localStorage" | "matchMedia">;
	readonly document: Pick<Document, "documentElement">;
}

const THEME_STORAGE_KEY = "securitydept-theme";

export class ThemeService implements DisposableTrait {
	private readonly preferenceSignal: WritableSignalTrait<ThemePreference>;
	private readonly mediaQuery: MediaQueryList;
	private listening = false;
	readonly preference: ReadableSignalTrait<ThemePreference>;

	constructor(private readonly host: ThemeServiceHost) {
		let preference: ThemePreference = ThemePreference.System;
		try {
			const stored = host.window.localStorage.getItem(THEME_STORAGE_KEY);
			if (Object.values(ThemePreference).includes(stored as ThemePreference)) {
				preference = stored as ThemePreference;
			}
		} catch {
			// Storage availability does not affect theme rendering.
		}

		this.preferenceSignal = createSignal(preference);
		this.preference = readonlySignal(this.preferenceSignal);
		this.mediaQuery = host.window.matchMedia("(prefers-color-scheme: dark)");
	}

	start(): void {
		this.apply(this.preferenceSignal.get());
		if (!this.listening) {
			this.listening = true;
			this.mediaQuery.addEventListener("change", this.handleSystemThemeChange);
		}
	}

	stop(): void {
		if (this.listening) {
			this.listening = false;
			this.mediaQuery.removeEventListener(
				"change",
				this.handleSystemThemeChange,
			);
		}
	}

	setPreference(preference: ThemePreference): void {
		this.preferenceSignal.set(preference);
		try {
			this.host.window.localStorage.setItem(THEME_STORAGE_KEY, preference);
		} catch {
			// A non-persistent preference remains valid for the current page.
		}
		this.apply(preference);
	}

	dispose(): void {
		this.stop();
	}

	[SYMBOL_DISPOSE](): void {
		this.dispose();
	}

	private readonly handleSystemThemeChange = (): void => {
		if (this.preferenceSignal.get() === ThemePreference.System) {
			this.apply(ThemePreference.System);
		}
	};

	private apply(preference: ThemePreference): void {
		const resolved: ResolvedThemePreference =
			preference === ThemePreference.System
				? this.mediaQuery.matches
					? ThemePreference.Dark
					: ThemePreference.Light
				: preference;
		this.host.document.documentElement.classList.toggle(
			"dark",
			resolved === ThemePreference.Dark,
		);
		this.host.document.documentElement.style.colorScheme = resolved;
	}
}
