// Orchestration client-level trace vocabulary.
//
// These constants name the current action each top-level token-set workflow
// performs. They are composed with the mode-specific trace prefix at emit time.
//
// Cross-layer context is carried by span hierarchy and trace prefix, not by a
// second global source/outcome vocabulary. Terminal results are expressed by
// the emitted auth event type and committed candidate kind, so this table
// deliberately avoids mirroring final outcome as trace words.
//
// Workflow source trace vocabulary stays co-located with each source and is
// intentionally not duplicated here.

export const TokenSetOrchestrationTraceEvent = {
	PersistedRestoreStarted: "restore.persisted.started",
	PersistedRestoreLoaded: "restore.persisted.loaded",
	PersistedRestoreFailed: "restore.persisted.failed",
	PersistenceSyncFailed: "persistence.sync.failed",
	StateRestored: "state.restored",
	StateCleared: "state.cleared",
	RefreshCommitted: "refresh.committed",
	RefreshFailed: "refresh.failed",
	Disposed: "disposed",
} as const;

export type TokenSetOrchestrationTraceEvent =
	(typeof TokenSetOrchestrationTraceEvent)[keyof typeof TokenSetOrchestrationTraceEvent];
