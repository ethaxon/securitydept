import { ResourceStatus } from "@securitydept/client";
import { useNavigate } from "@tanstack/react-router";
import { type AuthContextMode } from "@/auth/model";
import { useAuthMode, useAuthService } from "@/auth/react";

export function PlaygroundAccessBoundary({
	expectedMode,
	title,
	children,
}: {
	expectedMode: AuthContextMode;
	title: string;
	children: React.ReactNode;
}) {
	const authService = useAuthService();
	const navigate = useNavigate();
	const modeSnapshot = useAuthMode();
	if (
		modeSnapshot.status === ResourceStatus.LoadingError ||
		modeSnapshot.status === ResourceStatus.Error
	) {
		throw modeSnapshot.error;
	}
	if (
		modeSnapshot.status === ResourceStatus.Idle ||
		modeSnapshot.status === ResourceStatus.Loading
	) {
		return null;
	}
	const mode = modeSnapshot.value;

	if (mode !== null && mode !== expectedMode) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
				<div className="w-full max-w-md space-y-4 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
					<div className="space-y-1">
						<h2 className="text-base font-semibold">{title}</h2>
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							This reference page requires the{" "}
							<span className="font-medium text-zinc-700 dark:text-zinc-300">
								{expectedMode}
							</span>{" "}
							authentication context. You are currently signed in with a
							different context.
						</p>
						<p className="text-sm text-zinc-500 dark:text-zinc-400">
							Sign out first, then return to the login page and choose the
							matching context before using this playground.
						</p>
					</div>
					<button
						type="button"
						onClick={() => {
							authService.clearMode();
							void navigate({ to: "/login" });
						}}
						className="w-full rounded-lg border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
					>
						Sign out and go to login
					</button>
				</div>
			</div>
		);
	}

	return children;
}
