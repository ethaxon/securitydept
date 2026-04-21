use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use typed_builder::TypedBuilder;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthenticatedPrincipal {
    #[builder(setter(into))]
    pub subject: String,
    #[builder(setter(into))]
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub picture: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub issuer: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    #[builder(default)]
    pub claims: HashMap<String, Value>,
}

#[cfg(test)]
mod tests {
    use super::AuthenticatedPrincipal;

    #[test]
    fn builder_preserves_shared_authenticated_principal_fields() {
        let principal = AuthenticatedPrincipal::builder()
            .subject("user-1")
            .display_name("Alice")
            .issuer("https://issuer.example.com")
            .build();

        assert_eq!(principal.subject, "user-1");
        assert_eq!(principal.display_name, "Alice");
        assert_eq!(
            principal.issuer.as_deref(),
            Some("https://issuer.example.com")
        );
    }
}
