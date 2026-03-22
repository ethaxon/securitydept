use std::{collections::HashMap, time::Duration};

use openidconnect::{IntrospectionUrl, IssuerUrl, JsonWebKeySetUrl, core::CoreJsonWebKeySet};
use securitydept_creds::{JwtClaimsTrait, Scope, TokenData};
use serde_json::Value;

pub mod introspection;
#[cfg(feature = "jwe")]
pub mod jwe;

pub use introspection::VerifiedOpaqueToken;
#[cfg(feature = "jwe")]
pub use jwe::LocalJweDecryptionKeySet;

#[derive(Debug, Clone)]
pub struct OAuthResourceServerMetadata {
    pub issuer: IssuerUrl,
    pub jwks_uri: JsonWebKeySetUrl,
    pub introspection_url: Option<IntrospectionUrl>,
}

#[derive(Debug, Clone)]
pub struct VerificationPolicy {
    allowed_audiences: Vec<String>,
    required_scopes: Vec<String>,
    clock_skew: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceTokenPrincipal {
    pub subject: Option<String>,
    pub issuer: Option<String>,
    pub audiences: Vec<String>,
    pub scopes: Vec<String>,
    pub authorized_party: Option<String>,
    pub claims: HashMap<String, Value>,
}

impl VerificationPolicy {
    pub fn new(
        allowed_audiences: Vec<String>,
        required_scopes: Vec<String>,
        clock_skew: Duration,
    ) -> Self {
        Self {
            allowed_audiences,
            required_scopes,
            clock_skew,
        }
    }

    pub fn allowed_audiences(&self) -> &[String] {
        &self.allowed_audiences
    }

    pub fn required_scopes(&self) -> &[String] {
        &self.required_scopes
    }

    pub fn clock_skew(&self) -> Duration {
        self.clock_skew
    }
}

#[derive(Debug, Clone)]
pub struct JwksState {
    pub jwks: CoreJsonWebKeySet,
    pub fetched_at: std::time::Instant,
}

pub struct VerifiedAccessToken<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    pub token_data: TokenData<CLAIMS>,
    pub metadata: OAuthResourceServerMetadata,
}

pub enum VerifiedToken<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    Structured(Box<VerifiedAccessToken<CLAIMS>>),
    Opaque(Box<VerifiedOpaqueToken>),
}

impl<CLAIMS> From<VerifiedOpaqueToken> for VerifiedToken<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    fn from(value: VerifiedOpaqueToken) -> Self {
        Self::Opaque(Box::new(value))
    }
}

impl<CLAIMS> From<VerifiedAccessToken<CLAIMS>> for VerifiedToken<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    fn from(value: VerifiedAccessToken<CLAIMS>) -> Self {
        Self::Structured(Box::new(value))
    }
}

impl<CLAIMS> VerifiedToken<CLAIMS>
where
    CLAIMS: JwtClaimsTrait,
{
    pub fn to_resource_token_principal(&self) -> ResourceTokenPrincipal {
        match self {
            Self::Structured(token) => structured_token_principal(&token.token_data),
            Self::Opaque(token) => ResourceTokenPrincipal {
                subject: token.subject().map(str::to_string),
                issuer: token.issuer().map(str::to_string),
                audiences: token.audience().cloned().unwrap_or_default(),
                scopes: token.scopes().unwrap_or_default(),
                authorized_party: None,
                claims: HashMap::new(),
            },
        }
    }
}

fn structured_token_principal<CLAIMS>(token_data: &TokenData<CLAIMS>) -> ResourceTokenPrincipal
where
    CLAIMS: JwtClaimsTrait,
{
    let claims = match token_data {
        TokenData::JWT(token) => &token.claims,
        TokenData::Opaque => unreachable!("structured token data must not be opaque"),
        #[allow(unreachable_patterns)]
        _ => unreachable!("unexpected structured token variant"),
    };
    let additional = claims.get_additional().cloned().unwrap_or_default();
    let audiences = claims
        .get_audience()
        .map(|audience| audience.iter().cloned().collect())
        .unwrap_or_default();
    let scopes = additional
        .get("scope")
        .or_else(|| additional.get("scp"))
        .map(value_as_scope_list)
        .unwrap_or_default();

    ResourceTokenPrincipal {
        subject: claims.get_subject().map(str::to_string),
        issuer: claims.get_issuer().map(str::to_string),
        audiences,
        scopes,
        authorized_party: additional
            .get("azp")
            .and_then(Value::as_str)
            .map(str::to_string),
        claims: additional,
    }
}

fn value_as_scope_list(value: &Value) -> Vec<String> {
    match value {
        Value::String(raw) => raw
            .split_whitespace()
            .filter(|scope| !scope.is_empty())
            .map(str::to_string)
            .collect(),
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

pub fn scope_contains_all(scope: Option<&Scope>, required_scopes: &[String]) -> bool {
    if required_scopes.is_empty() {
        return true;
    }

    let Some(scope) = scope else {
        return false;
    };

    required_scopes
        .iter()
        .all(|required_scope| scope.iter().any(|value| value == required_scope))
}

#[cfg(test)]
mod tests {
    use securitydept_creds::Scope;

    use super::scope_contains_all;

    #[test]
    fn scope_policy_accepts_required_scopes() {
        let scope: Scope = serde_json::from_str("\"read write\"").expect("scope should parse");

        assert!(scope_contains_all(
            Some(&scope),
            &["read".to_string(), "write".to_string()]
        ));
    }

    #[test]
    fn scope_policy_rejects_missing_scope() {
        let scope: Scope = serde_json::from_str("\"read\"").expect("scope should parse");

        assert!(!scope_contains_all(Some(&scope), &["write".to_string()]));
    }
}
