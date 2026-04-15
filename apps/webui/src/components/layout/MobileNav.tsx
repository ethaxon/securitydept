import { Link, useMatchRoute } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { navItems, playgroundItems } from "./Sidebar";

export function MobileNav() {
	const matchRoute = useMatchRoute();

	return (
		<nav className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
			<div className="flex gap-2 overflow-x-auto">
				{navItems.map((item) => {
					const isActive = matchRoute({ to: item.to, fuzzy: item.to !== "/" });
					return (
						<Link
							key={item.to}
							to={item.to}
							className={cn(
								"inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
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

				{/* Divider */}
				<div className="mx-1 self-stretch border-l border-zinc-200 dark:border-zinc-700" />

				{playgroundItems.map((item) => {
					const isActive = matchRoute({ to: item.to, fuzzy: false });
					return (
						<Link
							key={item.to}
							to={item.to}
							className={cn(
								"inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
								isActive
									? "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300"
									: "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800",
							)}
						>
							<item.icon className="h-4 w-4" />
							{item.label}
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
