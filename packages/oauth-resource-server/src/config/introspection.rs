use serde::Deserialize;
use serde_with::serde_as;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde_as]
pub struct OAuthResourceServerIntrospectionConfig {
    /// Optional override for the RFC 7662 introspection endpoint.
    ///
    /// When omitted, the endpoint is read from discovery if available.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub introspection_url: Option<String>,
    /// OAuth client_id used when calling the introspection endpoint.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_id: Option<String>,
    /// OAuth client_secret used when calling the introspection endpoint.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub client_secret: Option<String>,
    /// Optional token type hint sent to the introspection endpoint.
    ///
    /// Typical values are `access_token` or `refresh_token`.
    #[serde(default)]
    #[serde_as(as = "NoneAsEmptyString")]
    pub token_type_hint: Option<String>,
}
