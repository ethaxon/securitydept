use openidconnect::{IntrospectionUrl, IssuerUrl, JsonWebKeySetUrl, core::CoreJsonWebKeySet};
use securitydept_creds::{JwtClaimsTrait, Scope, TokenData};

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
    clock_skew_seconds: u64,
}

impl VerificationPolicy {
    pub fn new(
        allowed_audiences: Vec<String>,
        required_scopes: Vec<String>,
        clock_skew_seconds: u64,
    ) -> Self {
        Self {
            allowed_audiences,
            required_scopes,
            clock_skew_seconds,
        }
    }

    pub fn allowed_audiences(&self) -> &[String] {
        &self.allowed_audiences
    }

    pub fn required_scopes(&self) -> &[String] {
        &self.required_scopes
    }

    pub fn clock_skew_seconds(&self) -> u64 {
        self.clock_skew_seconds
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
