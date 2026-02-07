import { AppIcon } from "@/components/common/AppIcon";

export function LoginPage() {
	return (
		<div className="flex h-screen items-center justify-center bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
			<div className="w-full max-w-sm space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
				<div className="flex flex-col items-center gap-2">
					<AppIcon className="h-10 w-10" />
					<h1 className="text-xl font-semibold">SecurityDept</h1>
					<p className="text-sm text-zinc-500 dark:text-zinc-400">
						Sign in with your identity provider
					</p>
				</div>
				<a
					href="/auth/login"
					className="flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
				>
					Sign in
				</a>
			</div>
		</div>
	);
}
