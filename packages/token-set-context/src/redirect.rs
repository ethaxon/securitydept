use securitydept_utils::redirect::{
    RedirectTargetConfig, RedirectTargetError, RedirectTargetRule, UriRedirectTargetResolver,
};
use url::Url;

pub type TokenSetRedirectUriConfig = RedirectTargetConfig;
pub type TokenSetRedirectUriRule = RedirectTargetRule;
pub type TokenSetRedirectUriError = RedirectTargetError;

#[derive(Clone, Debug)]
pub struct TokenSetRedirectUriResolver {
    resolver: UriRedirectTargetResolver,
}

impl TokenSetRedirectUriResolver {
    pub fn from_config(config: TokenSetRedirectUriConfig) -> Self {
        let resolver = UriRedirectTargetResolver::from_config(config)
            .expect("token-set redirect config must be validated before constructing a resolver");

        Self { resolver }
    }

    pub fn resolve_redirect_uri(
        &self,
        requested_redirect_uri: Option<&str>,
    ) -> Result<Url, TokenSetRedirectUriError> {
        let redirect_target = self
            .resolver
            .resolve_redirect_target(requested_redirect_uri)?;

        Url::parse(redirect_target.as_str()).map_err(|e| {
            TokenSetRedirectUriError::InvalidRedirectTarget {
                message: format!("resolved redirect target is invalid: {e}"),
            }
        })
    }
}
