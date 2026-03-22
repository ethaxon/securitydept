use crate::error::{CredsError, CredsResult};

pub fn is_bearer_auth_header(header_value: &str) -> bool {
    header_value.len() >= 7 && header_value[..7].eq_ignore_ascii_case("Bearer ")
}

/// Parse a bearer token header value ("Bearer <token>").
pub fn parse_bearer_auth_header_opt(header_value: &str) -> Option<String> {
    if is_bearer_auth_header(header_value) {
        Some(header_value[7..].trim().to_string())
    } else {
        None
    }
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
