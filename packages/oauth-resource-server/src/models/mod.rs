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
    let projected_claims = project_additional_claims(additional.clone());
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
        claims: projected_claims,
    }
}

fn project_additional_claims(additional: HashMap<String, Value>) -> HashMap<String, Value> {
    additional
        .into_iter()
        .filter(|(key, _)| !is_sensitive_additional_claim_key(key))
        .collect()
}

fn is_sensitive_additional_claim_key(key: &str) -> bool {
    let tokens = claim_key_tokens(key);
    if tokens.is_empty() {
        return false;
    }
    let token_slices = tokens.iter().map(String::as_str).collect::<Vec<_>>();

    if matches!(
        token_slices.as_slice(),
        ["access", "token"] | ["refresh", "token"] | ["id", "token"] | ["client", "secret"]
    ) {
        return true;
    }

    tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "authorization" | "password" | "secret" | "scope" | "scp" | "azp"
        )
    })
}

fn claim_key_tokens(key: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for character in key.chars() {
        if !character.is_ascii_alphanumeric() {
            if !current.is_empty() {
                tokens.push(std::mem::take(&mut current));
            }
            continue;
        }

        if character.is_ascii_uppercase()
            && !current.is_empty()
            && current
                .chars()
                .last()
                .is_some_and(|last| last.is_ascii_lowercase())
        {
            tokens.push(std::mem::take(&mut current));
        }

        current.push(character.to_ascii_lowercase());
    }

    if !current.is_empty() {
        tokens.push(current);
    }

    tokens
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
    use std::collections::HashMap;

    use securitydept_creds::{CoreJwtClaims, JwtHeader, Scope, TokenData};
    use serde_json::json;

    use super::{
        claim_key_tokens, is_sensitive_additional_claim_key, scope_contains_all,
        structured_token_principal,
    };

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

    #[test]
    fn sensitive_claim_key_matching_is_case_insensitive_and_separator_agnostic() {
        assert_eq!(claim_key_tokens("clientSecret"), vec!["client", "secret"]);
        assert!(is_sensitive_additional_claim_key("access_token"));
        assert!(is_sensitive_additional_claim_key("refreshToken"));
        assert!(is_sensitive_additional_claim_key("id-token"));
        assert!(is_sensitive_additional_claim_key("Authorization"));
        assert!(is_sensitive_additional_claim_key("authorization_header"));
        assert!(is_sensitive_additional_claim_key("client_secret"));
        assert!(is_sensitive_additional_claim_key("client-secret"));
        assert!(is_sensitive_additional_claim_key("provider_secret"));
        assert!(!is_sensitive_additional_claim_key("scoped_feature"));
        assert!(!is_sensitive_additional_claim_key("secretariat"));
    }

    #[test]
    fn structured_token_principal_projects_only_safe_additional_claims() {
        let mut additional = HashMap::new();
        additional.insert("access_token".to_string(), json!("at-1"));
        additional.insert("refreshToken".to_string(), json!("rt-1"));
        additional.insert("id-token".to_string(), json!("id-1"));
        additional.insert("Authorization".to_string(), json!("Bearer test"));
        additional.insert("clientSecret".to_string(), json!("top-secret"));
        additional.insert("provider_secret".to_string(), json!("nested-secret"));
        additional.insert("password".to_string(), json!("p@ss"));
        additional.insert("scope".to_string(), json!("read write"));
        additional.insert("scp".to_string(), json!(["read", "write"]));
        additional.insert("azp".to_string(), json!("webui-client"));
        additional.insert("tenant".to_string(), json!("acme"));
        additional.insert("feature_flags".to_string(), json!(["alpha"]));

        let principal =
            structured_token_principal(&TokenData::JWT(Box::new(jsonwebtoken::TokenData {
                header: JwtHeader::default(),
                claims: CoreJwtClaims {
                    subject: Some("user-1".to_string()),
                    issuer: Some("https://issuer.example.com".to_string()),
                    audience: Some(
                        serde_json::from_value(json!(["api", "web"]))
                            .expect("audience should parse"),
                    ),
                    expiration_time: Some(1_234_567_890),
                    not_before: None,
                    additional,
                },
            })));

        assert_eq!(principal.subject.as_deref(), Some("user-1"));
        assert_eq!(principal.authorized_party.as_deref(), Some("webui-client"));
        assert_eq!(
            principal.scopes,
            vec!["read".to_string(), "write".to_string()]
        );
        assert_eq!(principal.claims.get("tenant"), Some(&json!("acme")));
        assert_eq!(
            principal.claims.get("feature_flags"),
            Some(&json!(["alpha"]))
        );
        assert!(!principal.claims.contains_key("access_token"));
        assert!(!principal.claims.contains_key("refreshToken"));
        assert!(!principal.claims.contains_key("id-token"));
        assert!(!principal.claims.contains_key("Authorization"));
        assert!(!principal.claims.contains_key("clientSecret"));
        assert!(!principal.claims.contains_key("provider_secret"));
        assert!(!principal.claims.contains_key("password"));
        assert!(!principal.claims.contains_key("scope"));
        assert!(!principal.claims.contains_key("scp"));
        assert!(!principal.claims.contains_key("azp"));
    }
}
