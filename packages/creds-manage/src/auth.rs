use securitydept_creds::{
    BasicAuthCred, BasicAuthCredsConfig, BasicAuthCredsValidator, MapBasicAuthCredsValidator,
    MapStaticTokenAuthCredsValidator, StaticTokenAuthCredsConfig, token::TokenAuthCred,
};
pub use securitydept_creds::{
    hash_password_argon2, hash_token_sha256, parse_basic_auth_header_opt,
    parse_bearer_auth_header_opt, verify_password_argon2, verify_token_sha256,
};

use crate::{
    error::CredsManageResult,
    models::{BasicAuthEntry, TokenAuthEntry},
};

/// Check basic auth credentials against a list of entries in a group.
pub fn check_basic_auth(
    entries: &[BasicAuthEntry],
    username: &str,
    password: &str,
) -> CredsManageResult<Option<String>> {
    let validator = MapBasicAuthCredsValidator::from_config(&BasicAuthCredsConfig {
        users: entries.to_vec(),
    })?;

    if let Some(entry) = validator.get_cred(username)?
        && entry.verify_password(password)?
    {
        return Ok(Some(entry.meta.name.clone()));
    }

    Ok(None)
}

/// Check bearer token against a list of entries in a group.
pub fn check_token_auth(
    entries: &[TokenAuthEntry],
    token: &str,
) -> CredsManageResult<Option<String>> {
    let validator = MapStaticTokenAuthCredsValidator::from_config(&StaticTokenAuthCredsConfig {
        tokens: entries.to_vec(),
    })?;

    let token_hash = hash_token_sha256(token);
    if let Some(entry) = validator.creds.get(&token_hash)
        && entry.verify_token(token)?
    {
        return Ok(Some(entry.meta.name.clone()));
    }

    Ok(None)
}
