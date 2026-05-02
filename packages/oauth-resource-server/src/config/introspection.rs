use securitydept_utils::secret::{SecretString, deserialize_optional_secret_string};
use serde::Deserialize;
use serde_with::serde_as;

#[cfg_attr(feature = "config-schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, Deserialize, Default)]
#[serde_as]
pub struct OAuthResourceServerIntrospectionConfig {
    /// Optional override for the RFC 7662 introspection endpoint.
    ///
    /// When omitted, the endpoint is read from discovery if available.
    #[serde(default)]
    #[serde_as(as = "serde_with::NoneAsEmptyString")]
    #[cfg_attr(feature = "config-schema", schemars(with = "Option<String>"))]
    pub introspection_url: Option<String>,
    /// OAuth client_id used when calling the introspection endpoint.
    #[serde(default)]
    #[serde_as(as = "serde_with::NoneAsEmptyString")]
    #[cfg_attr(feature = "config-schema", schemars(with = "Option<String>"))]
    pub client_id: Option<String>,
    /// OAuth client_secret used when calling the introspection endpoint.
    #[serde(default, deserialize_with = "deserialize_optional_secret_string")]
    pub client_secret: Option<SecretString>,
    /// Optional token type hint sent to the introspection endpoint.
    ///
    /// Typical values are `access_token` or `refresh_token`.
    #[serde(default)]
    #[serde_as(as = "serde_with::NoneAsEmptyString")]
    #[cfg_attr(feature = "config-schema", schemars(with = "Option<String>"))]
    pub token_type_hint: Option<String>,
}
