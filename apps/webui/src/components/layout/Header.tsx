import { LogOut } from "lucide-react";
import { useLogout, useMe } from "@/api/auth";
import { AppIcon } from "@/components/common/AppIcon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "./ThemeToggle";

function getInitials(displayName: string) {
	return displayName.trim().slice(0, 2).toUpperCase();
}

function truncateDisplayName(displayName: string, maxLength: number) {
	const chars = Array.from(displayName);
	if (chars.length <= maxLength) {
		return displayName;
	}
	return `${chars.slice(0, maxLength).join("")}...`;
}

export function Header() {
	const { data: user } = useMe();
	const logout = useLogout();

	return (
		<header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
			<div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
				<div className="flex items-center gap-2">
					<AppIcon className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
					<span className="text-base font-semibold sm:text-lg">
						SecurityDept
					</span>
				</div>
				<div className="flex items-center gap-2 sm:gap-4">
					<ThemeToggle />
					{user && (
						<>
							<div className="flex items-center gap-2">
								<Avatar className="h-8 w-8">
									<AvatarImage src={user.picture} alt={user.display_name} />
									<AvatarFallback>
										{getInitials(user.display_name)}
									</AvatarFallback>
								</Avatar>
								<span className="hidden text-sm text-zinc-600 sm:inline dark:text-zinc-400">
									{truncateDisplayName(user.display_name, 20)}
								</span>
							</div>
							<button
								type="button"
								onClick={() => logout.mutate()}
								className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 sm:gap-1.5 sm:px-3 dark:text-zinc-400 dark:hover:bg-zinc-800"
							>
								<LogOut className="h-4 w-4" />
								<span className="hidden sm:inline">Logout</span>
							</button>
						</>
					)}
				</div>
			</div>
		</header>
	);
}
