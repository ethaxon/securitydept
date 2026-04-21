import type { TraceTimelineEntry } from "@securitydept/client";
import {
	formatTraceAttributes,
	readTraceBadgeClassName,
	readTraceDisplayType,
	readTraceDomainBadge,
	readTraceOutcomeBadge,
	readTraceSummary,
} from "./tracePresentation";

interface TraceTimelineSectionProps {
	events: readonly TraceTimelineEntry[];
	onClear: () => void;
}

export function TraceTimelineSection(props: TraceTimelineSectionProps) {
	const hasEvents = props.events.length > 0;

	return (
		<section
			data-testid="frontend-oidc-trace-timeline"
			className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
		>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
						Structured Trace Timeline
					</h2>
					<p className="mt-1 max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
						This reference view consumes the shared SDK trace sink directly. It
						covers popup lifecycle, callback outcomes, refresh, and the
						host-owned cross-tab adoption events wired into the same structured
						timeline.
					</p>
				</div>
				<button
					type="button"
					onClick={props.onClear}
					disabled={!hasEvents}
					className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
				>
					Clear Trace
				</button>
			</div>

			<div className="mt-4 space-y-3">
				{[...props.events].reverse().map((event) => {
					const domainBadge = readTraceDomainBadge(event);
					const outcomeBadge = readTraceOutcomeBadge(event);
					const summary = readTraceSummary(event);

					return (
						<div
							key={event.id}
							data-trace-type={event.type}
							data-trace-operation-id={event.operationId}
							className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="text-sm font-medium">
										{readTraceDisplayType(event)}
									</p>
									<p className="mt-1 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
										{event.type}
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
									{event.operationId && (
										<p className="mt-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
											Operation: {event.operationId}
										</p>
									)}
									<p className="mt-2 text-xs uppercase tracking-[0.16em] text-zinc-500 dark:text-zinc-400">
										{event.scope ?? "unknown scope"}
									</p>
								</div>
								<div className="text-right">
									<p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
										{event.recordedAtIso}
									</p>
									{event.source && (
										<p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
											Source: {event.source}
										</p>
									)}
								</div>
							</div>
							<pre className="mt-3 overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">
								{formatTraceAttributes(event)}
							</pre>
						</div>
					);
				})}
				{!hasEvents && (
					<div className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
						No frontend-mode trace events recorded yet. Start popup or redirect
						login, then inspect how the browser-owned flow was observed.
					</div>
				)}
			</div>
		</section>
	);
}
