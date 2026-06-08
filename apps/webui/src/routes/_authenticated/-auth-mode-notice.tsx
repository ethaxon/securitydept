export function AuthModeNotice({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-200">
			<p className="font-medium">{title}</p>
			<p className="mt-1 text-amber-700 dark:text-amber-300">{description}</p>
		</div>
	);
}
