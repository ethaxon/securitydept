import { UserRecovery } from "@securitydept/client";
import type { TraceTimelineEntry } from "@/lib/traceTimeline";

export const TraceBadgeTone = {
	Neutral: "neutral",
	Success: "success",
	Warning: "warning",
	Danger: "danger",
	Muted: "muted",
} as const;

export type TraceBadgeTone =
	(typeof TraceBadgeTone)[keyof typeof TraceBadgeTone];

export interface TraceBadge {
	label: string;
	tone: TraceBadgeTone;
}

const OUTCOME_BADGES: Record<string, TraceBadge> = {
	authenticated: { label: "Authenticated", tone: TraceBadgeTone.Success },
	cancel_requested: { label: "Superseded", tone: TraceBadgeTone.Muted },
	cancelled: { label: "Cancelled", tone: TraceBadgeTone.Muted },
	failed: { label: "Failed", tone: TraceBadgeTone.Danger },
	ready: { label: "Ready", tone: TraceBadgeTone.Success },
	started: { label: "Started", tone: TraceBadgeTone.Neutral },
	succeeded: { label: "Succeeded", tone: TraceBadgeTone.Success },
	unauthorized: { label: "Unauthorized", tone: TraceBadgeTone.Warning },
	validation_failed: { label: "Validation", tone: TraceBadgeTone.Warning },
};

export function readTraceDomainBadge(entry: TraceTimelineEntry): TraceBadge {
	if (
		entry.type.startsWith("token_set.app.") ||
		entry.scope === "apps.webui.token-set"
	) {
		return {
			label: "App Trace",
			tone: TraceBadgeTone.Neutral,
		};
	}

	return {
		label: "SDK Lifecycle",
		tone: TraceBadgeTone.Muted,
	};
}

export function readTraceOutcomeBadge(
	entry: TraceTimelineEntry,
): TraceBadge | null {
	const suffix = entry.type.split(".").at(-1);
	if (!suffix) {
		return null;
	}

	return OUTCOME_BADGES[suffix] ?? null;
}

export function readTraceDisplayType(entry: TraceTimelineEntry): string {
	if (entry.type.startsWith("token_set.app.")) {
		return entry.type.slice("token_set.app.".length);
	}

	if (entry.type.startsWith("token_set.")) {
		return entry.type.slice("token_set.".length);
	}

	return entry.type;
}

export function readTraceSummary(entry: TraceTimelineEntry): string | null {
	const attributes = entry.attributes ?? {};
	const fields: string[] = [];

	appendStringField(fields, attributes.path);
	appendStringField(fields, attributes.groupName);
	appendStringField(fields, attributes.entryName);
	appendStringField(fields, attributes.configStatus);
	appendStringField(fields, attributes.reason);
	appendNumberField(fields, attributes.count, "count");
	appendNumberField(fields, attributes.status, "status");
	appendPrefixedField(fields, attributes.kind, "kind");
	appendPrefixedField(fields, attributes.errorKind, "kind");
	appendPrefixedField(fields, attributes.code, "code");
	appendPrefixedField(fields, attributes.errorCode, "code");
	appendPrefixedField(fields, attributes.recovery, "recovery");

	return fields.length > 0 ? fields.join(" · ") : null;
}

export function formatTraceAttributes(entry: TraceTimelineEntry): string {
	if (!entry.attributes || Object.keys(entry.attributes).length === 0) {
		return "{}";
	}

	return JSON.stringify(entry.attributes, null, 2);
}

export function readTraceBadgeClassName(tone: TraceBadgeTone): string {
	switch (tone) {
		case TraceBadgeTone.Success:
			return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300";
		case TraceBadgeTone.Warning:
			return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300";
		case TraceBadgeTone.Danger:
			return "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300";
		case TraceBadgeTone.Muted:
			return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300";
		default:
			return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300";
	}
}

function appendStringField(fields: string[], value: unknown): void {
	if (typeof value === "string" && value.length > 0) {
		fields.push(value);
	}
}

function appendPrefixedField(
	fields: string[],
	value: unknown,
	label: string,
): void {
	if (
		typeof value === "string" &&
		value.length > 0 &&
		value !== UserRecovery.None
	) {
		fields.push(`${label}: ${value}`);
	}
}

function appendNumberField(
	fields: string[],
	value: unknown,
	label: string,
): void {
	if (typeof value === "number" && Number.isFinite(value)) {
		fields.push(`${label}: ${value}`);
	}
}
