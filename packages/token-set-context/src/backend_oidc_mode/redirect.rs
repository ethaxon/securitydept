// ---------------------------------------------------------------------------
// Redirect URI resolver — unified backend-oidc capability infrastructure
//
// Implements the `post_auth_redirect_policy = resolved` capability axis.
// ---------------------------------------------------------------------------

use securitydept_utils::redirect::{
    RedirectTargetConfig, RedirectTargetError, RedirectTargetRule, UriRedirectTargetResolver,
};
use url::Url;

pub type BackendOidcModeRedirectUriConfig = RedirectTargetConfig;
pub type BackendOidcModeRedirectUriRule = RedirectTargetRule;
pub type BackendOidcModeRedirectUriError = RedirectTargetError;

#[derive(Clone, Debug)]
pub struct BackendOidcModeRedirectUriResolver {
    resolver: UriRedirectTargetResolver,
}

impl BackendOidcModeRedirectUriResolver {
    pub fn from_config(config: BackendOidcModeRedirectUriConfig) -> Self {
        let resolver = UriRedirectTargetResolver::from_config(config)
            .expect("token-set redirect config must be validated before constructing a resolver");

        Self { resolver }
    }

    pub fn resolve_redirect_uri(
        &self,
        requested_redirect_uri: Option<&str>,
    ) -> Result<Url, BackendOidcModeRedirectUriError> {
        let redirect_target = self
            .resolver
            .resolve_redirect_target(requested_redirect_uri)?;

        Url::parse(redirect_target.as_str()).map_err(|e| {
            BackendOidcModeRedirectUriError::InvalidRedirectTarget {
                message: format!("resolved redirect target is invalid: {e}"),
            }
        })
    }
}
