import { TokenSetOrchestrationTraceEvent } from "../../orchestration/client/tracing";
import {
	TokenSetPageResumeWorkflowSource,
	TokenSetPageResumeWorkflowSourceTraceEventType,
} from "../../orchestration/client/workflows/source/page-resume";
import {
	TokenSetRefreshTimerWorkflowSource,
	TokenSetRefreshTimerWorkflowSourceTraceEventType,
} from "../../orchestration/client/workflows/source/refresh-timer";

const TRACE_PREFIX = "backend_oidc";

export const BackendOidcModeTraceEventType = {
	UserInfoFallbackFailed: "backend_oidc.user_info.fallback_failed",
} as const;

export type BackendOidcModeTraceEventType =
	(typeof BackendOidcModeTraceEventType)[keyof typeof BackendOidcModeTraceEventType];

export const BackendOidcModeTraceOperationName = {
	LoginRedirect: "backend_oidc.login.redirect",
	LoginPopup: "backend_oidc.login.popup",
	Callback: "backend_oidc.callback",
	Refresh: "backend_oidc.refresh",
	UserInfo: "backend_oidc.user_info",
	MetadataRedemption: "backend_oidc.metadata_redemption",
} as const;

export type BackendOidcModeTraceOperationName =
	(typeof BackendOidcModeTraceOperationName)[keyof typeof BackendOidcModeTraceOperationName];

export const BackendOidcModeOperationEventName = {
	PopupOpened: "popup.opened",
	PopupRelaySucceeded: "popup.relay.succeeded",
	MetadataRedemptionStarted: "metadata_redemption.started",
	MetadataRedemptionSucceeded: "metadata_redemption.succeeded",
} as const;

export type BackendOidcModeOperationEventName =
	(typeof BackendOidcModeOperationEventName)[keyof typeof BackendOidcModeOperationEventName];

/** Orchestration and workflow-source events composed with the backend-oidc trace prefix. */
export const BackendOidcModeComposedTraceEventType = {
	PersistedRestoreFailed: `${TRACE_PREFIX}.${TokenSetOrchestrationTraceEvent.PersistedRestoreFailed}`,
	PersistenceSyncFailed: `${TRACE_PREFIX}.${TokenSetOrchestrationTraceEvent.PersistenceSyncFailed}`,
	StateRestored: `${TRACE_PREFIX}.${TokenSetOrchestrationTraceEvent.StateRestored}`,
	RefreshTimerScheduled: `${TRACE_PREFIX}.${TokenSetRefreshTimerWorkflowSource.name}.${TokenSetRefreshTimerWorkflowSourceTraceEventType.Scheduled}`,
	RefreshTimerFired: `${TRACE_PREFIX}.${TokenSetRefreshTimerWorkflowSource.name}.${TokenSetRefreshTimerWorkflowSourceTraceEventType.Fired}`,
	PageResumeFired: `${TRACE_PREFIX}.${TokenSetPageResumeWorkflowSource.name}.${TokenSetPageResumeWorkflowSourceTraceEventType.Fired}`,
} as const;

export type BackendOidcModeComposedTraceEventType =
	(typeof BackendOidcModeComposedTraceEventType)[keyof typeof BackendOidcModeComposedTraceEventType];
