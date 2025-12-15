import { LogOut, Shield } from "lucide-react";
import { useLogout, useMe } from "@/api/auth";

export function Header() {
	const { data: user } = useMe();
	const logout = useLogout();

	return (
		<header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
			<div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
				<div className="flex items-center gap-2">
					<Shield className="h-5 w-5 text-blue-600" />
					<span className="text-lg font-semibold">SecurityDept</span>
				</div>
				{user && (
					<div className="flex items-center gap-4">
						<span className="text-sm text-zinc-600 dark:text-zinc-400">
							{user.display_name}
						</span>
						<button
							type="button"
							onClick={() => logout.mutate()}
							className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
						>
							<LogOut className="h-4 w-4" />
							Logout
						</button>
					</div>
				)}
			</div>
		</header>
	);
}
