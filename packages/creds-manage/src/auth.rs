use crate::error::CredsManageResult;
use crate::models::{AuthEntryKind, AuthEntryMeta};

pub use securitydept_creds::{
    generate_token, hash_password_argon2, parse_basic_auth_header_opt,
    parse_bearer_auth_header_opt, verify_password_argon2, verify_token_sha256,
};

/// Check basic auth credentials against a list of entries in a group.
pub fn check_basic_auth(
    entries: &[AuthEntryMeta],
    username: &str,
    password: &str,
) -> CredsManageResult<Option<String>> {
    for entry in entries {
        if entry.kind != AuthEntryKind::Basic {
            continue;
        }
        if entry.username.as_deref() == Some(username)
            && let Some(ref ph) = entry.password_hash
            && verify_password_argon2(password, ph)?
        {
            return Ok(Some(entry.name.clone()));
        }
    }
    Ok(None)
}

/// Check bearer token against a list of entries in a group.
pub fn check_token_auth(entries: &[AuthEntryMeta], token: &str) -> Option<String> {
    for entry in entries {
        if entry.kind != AuthEntryKind::Token {
            continue;
        }
        if let Some(ref th) = entry.token_hash
            && verify_token(token, th)
        {
            return Some(entry.name.clone());
        }
    }
    None
}
