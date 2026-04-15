export function AuthModeNotice({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
			<p className="text-sm font-semibold">{title}</p>
			<p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
				{description}
			</p>
		</div>
	);
}
