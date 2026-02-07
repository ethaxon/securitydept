import { Monitor, Moon, Sun } from "lucide-react";
import { type ThemePreference, useThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const options: Array<{
	value: ThemePreference;
	label: string;
	icon: typeof Sun;
}> = [
	{ value: "system", label: "System", icon: Monitor },
	{ value: "light", label: "Light", icon: Sun },
	{ value: "dark", label: "Dark", icon: Moon },
];

export function ThemeToggle() {
	const { preference, setPreference } = useThemePreference();

	return (
		<div className="inline-flex items-center rounded-md border border-zinc-200 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900">
			{options.map((option) => {
				const active = preference === option.value;
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => setPreference(option.value)}
						className={cn(
							"inline-flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
							active
								? "bg-blue-600 text-white"
								: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
						)}
					>
						<option.icon className="h-3.5 w-3.5" />
						<span className="hidden sm:inline">{option.label}</span>
					</button>
				);
			})}
		</div>
	);
}
