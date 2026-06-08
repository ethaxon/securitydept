export const FrontendOidcModeConfigErrorCode = {
	SourcesExhausted: "frontend_oidc.config.sources_exhausted",
	InvalidProjection: "frontend_oidc.config.invalid_projection",
	MultiplePersistedSources: "frontend_oidc.config.multiple_persisted_sources",
	PersistenceReadFailed: "frontend_oidc.config.persistence_read_failed",
	PersistenceWriteFailed: "frontend_oidc.config.persistence_write_failed",
} as const;

export type FrontendOidcModeConfigErrorCode =
	(typeof FrontendOidcModeConfigErrorCode)[keyof typeof FrontendOidcModeConfigErrorCode];

export const FrontendOidcModeConfigErrorSource = "frontend_oidc.config";
