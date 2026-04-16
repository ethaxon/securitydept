import { Link, useMatchRoute } from "@tanstack/react-router";
import {
	FlaskConical,
	KeyRound,
	LayoutDashboard,
	Lock,
	Shield,
	Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const navItems = [
	{ to: "/", label: "Dashboard", icon: LayoutDashboard },
	{ to: "/entries", label: "Auth Entries", icon: KeyRound },
	{ to: "/groups", label: "Groups", icon: Users },
] as const;

export const playgroundItems = [
	{ to: "/playground/session", label: "Session", icon: Shield },
	{
		to: "/playground/token-set/backend-mode",
		label: "Token Set Backend",
		icon: FlaskConical,
	},
	{
		to: "/playground/token-set/frontend-mode",
		label: "Token Set Frontend",
		icon: FlaskConical,
	},
	{ to: "/playground/basic-auth", label: "Basic Auth", icon: Lock },
] as const;

export function Sidebar() {
	const matchRoute = useMatchRoute();

	return (
		<aside className="hidden w-56 shrink-0 border-r border-zinc-200 bg-zinc-50 md:block dark:border-zinc-800 dark:bg-zinc-900">
			<nav className="flex flex-col gap-4 p-3">
				{/* Main navigation */}
				<div className="flex flex-col gap-1">
					{navItems.map((item) => {
						const isActive = matchRoute({
							to: item.to,
							fuzzy: item.to !== "/",
						});
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
				</div>

				{/* Playgrounds section */}
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-1.5 px-3 pb-0.5">
						<div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
						<span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
							Playgrounds
						</span>
						<div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
					</div>
					{playgroundItems.map((item) => {
						const isActive = matchRoute({ to: item.to, fuzzy: false });
						return (
							<Link
								key={item.to}
								to={item.to}
								className={cn(
									"flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
		</aside>
	);
}
