import { type TraceTimelineEntry, UserRecovery } from "@securitydept/client";

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
	"popupCallbackUrl",
	"operationName",
	"eventName",
	"configuredIssuer",
	"resolvedIssuer",
	"state",
	"reason",
	"errorCode",
	"code",
	"recovery",
	"persisted",
	"hasClaimsCheck",
	"newIdToken",
	"hasAccessToken",
	"syncCount",
]);

const OUTCOME_BADGES: Record<string, TraceBadge> = {
	cleared: { label: "Cleared", tone: TraceBadgeTone.Muted },
	failed: { label: "Failed", tone: TraceBadgeTone.Danger },
	hydrated: { label: "Hydrated", tone: TraceBadgeTone.Success },
	opened: { label: "Opened", tone: TraceBadgeTone.Neutral },
	started: { label: "Started", tone: TraceBadgeTone.Neutral },
	succeeded: { label: "Succeeded", tone: TraceBadgeTone.Success },
};

export function readTraceDomainBadge(entry: TraceTimelineEntry): TraceBadge {
	if (entry.name.startsWith("operation.")) {
		return {
			label: "Operation Lifecycle",
			tone: TraceBadgeTone.Neutral,
		};
	}

	if (
		entry.name.startsWith("frontend_oidc.host.") ||
		entry.target === "apps.webui.token-set-frontend"
	) {
		return {
			label: "Host Adoption",
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

	if (entry.name.startsWith("frontend_oidc.")) {
		return entry.name.slice("frontend_oidc.".length);
	}

	return entry.name;
}

export function readTraceSummary(entry: TraceTimelineEntry): string | null {
	const metadata = entry.fields ?? {};
	const parts: string[] = [];

	appendStringField(parts, metadata.popupCallbackUrl);
	appendStringField(parts, metadata.operationName, "operation");
	appendStringField(parts, metadata.eventName, "event");
	appendStringField(parts, metadata.configuredIssuer);
	appendStringField(parts, metadata.resolvedIssuer);
	appendStringField(parts, metadata.state, "state");
	appendStringField(parts, metadata.reason, "reason");
	appendStringField(parts, metadata.errorCode, "code");
	appendStringField(parts, metadata.code, "code");
	appendStringField(parts, metadata.recovery, "recovery");
	appendBooleanField(parts, metadata.persisted, "persisted");
	appendBooleanField(parts, metadata.hasClaimsCheck, "claims_check");
	appendBooleanField(parts, metadata.newIdToken, "new_id_token");
	appendBooleanField(parts, metadata.hasAccessToken, "has_access_token");
	appendNumberField(parts, metadata.syncCount, "sync_count");

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

function appendStringField(
	fields: string[],
	value: unknown,
	label?: string,
): void {
	if (
		typeof value === "string" &&
		value.length > 0 &&
		value !== UserRecovery.None
	) {
		fields.push(label ? `${label}: ${value}` : value);
	}
}

function appendBooleanField(
	fields: string[],
	value: unknown,
	label: string,
): void {
	if (typeof value === "boolean") {
		fields.push(`${label}: ${String(value)}`);
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
