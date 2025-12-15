import { Link, useMatchRoute } from "@tanstack/react-router";
import { KeyRound, LayoutDashboard, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
	{ to: "/", label: "Dashboard", icon: LayoutDashboard },
	{ to: "/entries", label: "Auth Entries", icon: KeyRound },
	{ to: "/groups", label: "Groups", icon: Users },
] as const;

export function Sidebar() {
	const matchRoute = useMatchRoute();

	return (
		<aside className="w-56 shrink-0 border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
			<nav className="flex flex-col gap-1 p-3">
				{navItems.map((item) => {
					const isActive = matchRoute({ to: item.to, fuzzy: item.to !== "/" });
					return (
						<Link
							key={item.to}
							to={item.to}
							className={cn(
								"flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
								isActive
									? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
									: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
							)}
						>
							<item.icon className="h-4 w-4" />
							{item.label}
						</Link>
					);
				})}
			</nav>
		</aside>
	);
}
