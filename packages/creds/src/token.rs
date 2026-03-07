use crate::error::{CredsError, CredsResult};

/// Parse a bearer token header value ("Bearer <token>").
pub fn parse_bearer_auth_header_opt(header_value: &str) -> Option<String> {
    header_value.strip_prefix("Bearer ").map(|t| t.to_string())
}

pub fn parse_bearer_auth_header(header_value: &str) -> Result<String, CredsError> {
    parse_bearer_auth_header_opt(header_value).ok_or_else(|| CredsError::InvalidCredentialsFormat {
        message: "Authorization header must have 'Bearer' scheme and token for token auth "
            .to_string(),
    })
}

pub trait TokenAuthCred {
    fn verify_token(&self, token: &str) -> CredsResult<bool>;
}
