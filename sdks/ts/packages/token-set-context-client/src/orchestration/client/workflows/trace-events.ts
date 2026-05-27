// Orchestration host-level trace vocabulary.
//
// These constants name the *current action* each top-level token-set workflow
// performs. They are composed with the mode-specific `tracePrefix` at emit time
// (e.g. `${tracePrefix}.${TokenSetOrchestrationTraceEvent.StateRestored}`).
//
// Cross-layer context — which parent action triggered this, and which OIDC mode
// is running — is carried by the span stack and the `tracePrefix`, NOT by a
// second global source/outcome vocabulary. Terminal results are expressed by
// the emitted auth event type and the committed candidate kind, so this table
// deliberately avoids mirroring "what was the final outcome" as trace words.
//
// Workflow *source* trace vocabulary (e.g. refresh timer scheduled/fired) stays
// co-located with each source and is intentionally not duplicated here.

export const TokenSetOrchestrationTraceEvent = {
	PersistedRestoreStarted: "restore.persisted.started",
	PersistedRestoreLoaded: "restore.persisted.loaded",
	PersistedRestoreFailed: "restore.persisted.failed",
	StateRestored: "state.restored",
	StateCleared: "state.cleared",
	RefreshCommitted: "refresh.committed",
	RefreshFailed: "refresh.failed",
	Disposed: "disposed",
} as const;

export type TokenSetOrchestrationTraceEvent =
	(typeof TokenSetOrchestrationTraceEvent)[keyof typeof TokenSetOrchestrationTraceEvent];
