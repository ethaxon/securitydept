import { type TraceTimelineEntry } from "@securitydept/client";
import {
	formatTraceFields,
	readTraceBadgeClassName,
	readTraceDisplayType,
	readTraceDomainBadge,
	readTraceOutcomeBadge,
	readTraceSummary,
} from "./trace-presentation";

interface TraceTimelineSectionProps {
	events: readonly TraceTimelineEntry[];
	onClear: () => void;
}

export function TraceTimelineSection(props: TraceTimelineSectionProps) {
	const hasEvents = props.events.length > 0;

	return (
		<section
			data-testid="token-set-backend-trace-timeline"
			className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
					Trace timeline
				</h2>
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={props.onClear}
						disabled={!hasEvents}
						className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
					>
						Clear Trace
					</button>
				</div>
			</div>

			<div className="mt-4 space-y-3">
				{[...props.events].reverse().map((event) => {
					const domainBadge = readTraceDomainBadge(event);
					const outcomeBadge = readTraceOutcomeBadge(event);
					const summary = readTraceSummary(event);
					const details = formatTraceFields(event);

					return (
						<div
							key={event.id}
							data-trace-operation-id={event.span.id}
							className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="text-sm font-medium">
										{readTraceDisplayType(event)}
									</p>
									<div className="mt-2 flex flex-wrap gap-2">
										<span
											className={`rounded-full border px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${readTraceBadgeClassName(domainBadge.tone)}`}
										>
											{domainBadge.label}
										</span>
										{outcomeBadge && (
											<span
												className={`rounded-full border px-2 py-1 text-[11px] font-medium uppercase tracking-[0.12em] ${readTraceBadgeClassName(outcomeBadge.tone)}`}
											>
												{outcomeBadge.label}
											</span>
										)}
									</div>
									{summary && (
										<p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
											{summary}
										</p>
									)}
								</div>
								<div className="text-right">
									<p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
										{event.recordedAtIso}
									</p>
								</div>
							</div>
							{details ? (
								<details className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
									<summary className="cursor-pointer select-none">
										Details
									</summary>
									<pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
										{details}
									</pre>
								</details>
							) : null}
						</div>
					);
				})}
				{!hasEvents && (
					<div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
						No trace events yet.
					</div>
				)}
			</div>
		</section>
	);
}
