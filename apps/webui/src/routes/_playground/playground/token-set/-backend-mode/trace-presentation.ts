import {
	SpanSharedAttributeName,
	type TraceTimelineEntry,
	UserRecovery,
} from "@securitydept/client";
import { TOKEN_SET_BACKEND_MODE_CONFIG } from "@/auth/token-set/config";

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

const SUMMARY_FIELD_KEYS = new Set([
	"path",
	SpanSharedAttributeName.OperationName,
	"eventName",
	"groupName",
	"entryName",
	"configStatus",
	"reason",
	"count",
	"status",
	"kind",
	"errorKind",
	"code",
	"errorCode",
	"recovery",
]);

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
	if (entry.name.startsWith("operation.")) {
		return {
			label: "Operation Lifecycle",
			tone: TraceBadgeTone.Neutral,
		};
	}

	if (
		entry.name.startsWith("token_set.app.") ||
		entry.target === TOKEN_SET_BACKEND_MODE_CONFIG.tracing.hostTarget
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
	const suffix = entry.name.split(".").at(-1);
	if (!suffix) {
		return null;
	}

	return OUTCOME_BADGES[suffix] ?? null;
}

export function readTraceDisplayType(entry: TraceTimelineEntry): string {
	if (entry.name.startsWith("operation.")) {
		return entry.name.slice("operation.".length);
	}

	if (entry.name.startsWith("token_set.app.")) {
		return entry.name.slice("token_set.app.".length);
	}

	if (entry.name.startsWith("token_set.")) {
		return entry.name.slice("token_set.".length);
	}

	return entry.name;
}

export function readTraceSummary(entry: TraceTimelineEntry): string | null {
	const metadata = Object.assign(
		{},
		...entry.spanAttributes.map((frame) => frame.attributes),
		entry.fields,
	);
	const parts: string[] = [];

	appendStringField(parts, metadata.path);
	appendPrefixedField(
		parts,
		metadata[SpanSharedAttributeName.OperationName],
		"operation",
	);
	appendPrefixedField(parts, metadata.eventName, "event");
	appendStringField(parts, metadata.groupName);
	appendStringField(parts, metadata.entryName);
	appendStringField(parts, metadata.configStatus);
	appendStringField(parts, metadata.reason);
	appendNumberField(parts, metadata.count, "count");
	appendNumberField(parts, metadata.status, "status");
	appendPrefixedField(parts, metadata.kind, "kind");
	appendPrefixedField(parts, metadata.errorKind, "kind");
	appendPrefixedField(parts, metadata.code, "code");
	appendPrefixedField(parts, metadata.errorCode, "code");
	appendPrefixedField(parts, metadata.recovery, "recovery");

	return parts.length > 0 ? parts.join(" · ") : null;
}

export function formatTraceFields(entry: TraceTimelineEntry): string | null {
	if (!entry.fields) {
		return null;
	}

	const details = Object.fromEntries(
		Object.entries(entry.fields).filter(
			([key]) => !SUMMARY_FIELD_KEYS.has(key),
		),
	);
	return Object.keys(details).length > 0
		? JSON.stringify(details, null, 2)
		: null;
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
