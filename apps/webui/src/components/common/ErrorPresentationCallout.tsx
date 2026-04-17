import type { ErrorPresentationDescriptor } from "@securitydept/client";

interface ErrorPresentationCalloutProps {
	descriptor: ErrorPresentationDescriptor;
	eyebrow: string;
	className?: string;
}

export function ErrorPresentationCallout(props: ErrorPresentationCalloutProps) {
	const toneClassName =
		props.descriptor.tone === "warning"
			? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/80 dark:bg-amber-950/40 dark:text-amber-100"
			: props.descriptor.tone === "neutral"
				? "border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
				: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/80 dark:bg-rose-950/40 dark:text-rose-100";

	return (
		<div
			data-error-code={props.descriptor.code ?? "unknown"}
			data-error-recovery={props.descriptor.recovery}
			data-error-title={props.descriptor.title}
			className={`space-y-4 rounded-xl border px-4 py-4 ${toneClassName}${props.className ? ` ${props.className}` : ""}`}
		>
			<div className="space-y-2">
				<p className="text-xs font-semibold uppercase tracking-[0.22em]">
					{props.eyebrow}
				</p>
				<h2 className="text-xl font-semibold">{props.descriptor.title}</h2>
				<p className="text-sm leading-6 opacity-90">
					{props.descriptor.description}
				</p>
			</div>
			<dl className="grid gap-3 text-sm opacity-90 sm:grid-cols-2">
				<div className="space-y-1 rounded-xl border border-current/10 bg-white/40 px-4 py-3 dark:bg-black/10">
					<dt className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-70">
						Error code
					</dt>
					<dd className="font-mono text-sm">
						{props.descriptor.code ?? "unknown"}
					</dd>
				</div>
				<div className="space-y-1 rounded-xl border border-current/10 bg-white/40 px-4 py-3 dark:bg-black/10">
					<dt className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-70">
						Recovery
					</dt>
					<dd className="font-mono text-sm">{props.descriptor.recovery}</dd>
				</div>
			</dl>
			{props.descriptor.primaryAction ? (
				props.descriptor.primaryAction.href ? (
					<a
						href={props.descriptor.primaryAction.href}
						className="inline-flex items-center justify-center rounded-lg border border-current/20 px-4 py-2 text-sm font-medium transition-colors hover:bg-white/40 dark:hover:bg-black/10"
					>
						{props.descriptor.primaryAction.label}
					</a>
				) : (
					<p className="text-sm font-medium opacity-90">
						Recommended action: {props.descriptor.primaryAction.label}
					</p>
				)
			) : null}
		</div>
	);
}
