// ---------------------------------------------------------------------------
// Redirect URI resolver — unified backend-oidc capability infrastructure
//
// Implements the `post_auth_redirect_policy = resolved` capability axis.
// ---------------------------------------------------------------------------

use securitydept_utils::redirect::{
    RedirectTargetConfig, RedirectTargetError, RedirectTargetRule,
    UriReferenceRedirectTargetResolver,
};
use url::Url;

pub type BackendOidcModeRedirectUriConfig = RedirectTargetConfig;
pub type BackendOidcModeRedirectUriRule = RedirectTargetRule;
pub type BackendOidcModeRedirectUriError = RedirectTargetError;

#[derive(Clone, Debug)]
pub struct BackendOidcModeRedirectUriResolver {
    resolver: UriReferenceRedirectTargetResolver,
}

impl BackendOidcModeRedirectUriResolver {
    pub fn from_config(config: BackendOidcModeRedirectUriConfig) -> Self {
        let resolver = UriReferenceRedirectTargetResolver::from_config(config)
            .expect("token-set redirect config must be validated before constructing a resolver");

        Self { resolver }
    }

    /// Resolve the post-auth redirect URI.
    ///
    /// The resolved value may be a relative path (e.g. `/playground/token-set`)
    /// or an absolute URI. Relative paths are joined with `external_base_url`
    /// to produce a full URL.
    pub fn resolve_redirect_uri(
        &self,
        requested_redirect_uri: Option<&str>,
        external_base_url: &Url,
    ) -> Result<Url, BackendOidcModeRedirectUriError> {
        let redirect_target = self
            .resolver
            .resolve_redirect_target(requested_redirect_uri)?;

        let target_str = redirect_target.as_str();

        // Try parsing as an absolute URL first; fall back to joining with
        // external_base_url for relative paths.
        Url::parse(target_str).or_else(|_| {
            external_base_url.join(target_str).map_err(|e| {
                BackendOidcModeRedirectUriError::InvalidRedirectTarget {
                    message: format!(
                        "failed to resolve relative redirect target '{target_str}' against \
                         external_base_url: {e}"
                    ),
                }
            })
        })
    }
}
