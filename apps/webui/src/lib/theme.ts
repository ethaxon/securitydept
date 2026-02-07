import { useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const THEME_STORAGE_KEY = "securitydept-theme";

function getSystemTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "light";
	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

function applyTheme(preference: ThemePreference) {
	if (typeof document === "undefined") return;
	const root = document.documentElement;
	const resolved = preference === "system" ? getSystemTheme() : preference;
	root.classList.toggle("dark", resolved === "dark");
	root.style.colorScheme = resolved;
}

function readThemePreference(): ThemePreference {
	if (typeof window === "undefined") return "system";
	try {
		const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
		if (stored === "light" || stored === "dark" || stored === "system") {
			return stored;
		}
	} catch {
		// Ignore storage read errors and fallback to system preference.
	}
	return "system";
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
	const [preference, setPreference] = useState<ThemePreference>("system");

	useEffect(() => {
		const initial = readThemePreference();
		setPreference(initial);
		applyTheme(initial);
	}, []);

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => {
			if (preference === "system") {
				applyTheme("system");
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
