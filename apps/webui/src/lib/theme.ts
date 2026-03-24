import { useEffect, useState } from "react";

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

const THEME_STORAGE_KEY = "securitydept-theme";

function getSystemTheme(): ResolvedThemePreference {
	if (typeof window === "undefined") return ThemePreference.Light;
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? ThemePreference.Dark
		: ThemePreference.Light;
}

function applyTheme(preference: ThemePreference) {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	const resolved =
		preference === ThemePreference.System ? getSystemTheme() : preference;
	root.classList.toggle("dark", resolved === ThemePreference.Dark);
	root.style.colorScheme = resolved;
}

function readThemePreference(): ThemePreference {
	if (typeof window === "undefined") return ThemePreference.System;
	try {
		const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		if (Object.values(ThemePreference).includes(stored as ThemePreference)) {
			return stored as ThemePreference;
		}
	} catch {
		// Ignore storage read errors and fallback to system preference.
	}
	return ThemePreference.System;
}

function persistThemePreference(preference: ThemePreference) {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		// Ignore storage write errors.
	}
}

export function useThemePreference() {
	const [preference, setPreference] = useState<ThemePreference>(
		ThemePreference.System,
	);

	useEffect(() => {
		const initial = readThemePreference();
		setPreference(initial);
		applyTheme(initial);
	}, []);

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => {
			if (preference === ThemePreference.System) {
				applyTheme(ThemePreference.System);
			}
		};

		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [preference]);

	const updatePreference = (next: ThemePreference) => {
		setPreference(next);
		persistThemePreference(next);
		applyTheme(next);
	};

	return {
		preference,
		setPreference: updatePreference,
	};
}
