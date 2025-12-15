use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use rand::Rng;
use rand::rngs::OsRng;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};
use crate::models::{AuthEntry, AuthEntryKind};

/// Hash a plaintext password with argon2.
pub fn hash_password(password: &str) -> Result<String> {
    let salt = argon2::password_hash::SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| Error::PasswordHash {
            message: e.to_string(),
        })?;
    Ok(hash.to_string())
}

/// Verify a plaintext password against an argon2 hash.
pub fn verify_password(password: &str, hash: &str) -> Result<bool> {
    let parsed = PasswordHash::new(hash).map_err(|e| Error::PasswordHash {
        message: e.to_string(),
    })?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

/// Generate a random token and return (plaintext, sha256_hex_hash).
pub fn generate_token() -> (String, String) {
    let mut bytes = [0u8; 32];
    OsRng.fill(&mut bytes);
    let token = BASE64.encode(bytes);
    let hash = hash_token(&token);
    (token, hash)
}

/// Hash a token with SHA-256 and return hex.
pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Verify a token against a stored SHA-256 hex hash.
pub fn verify_token(token: &str, stored_hash: &str) -> bool {
    hash_token(token) == stored_hash
}

/// Check basic auth credentials against a list of entries in a group.
pub fn check_basic_auth(
    entries: &[AuthEntry],
    username: &str,
    password: &str,
) -> Result<Option<String>> {
    for entry in entries {
        if entry.kind != AuthEntryKind::Basic {
            continue;
        }
        if entry.username.as_deref() == Some(username)
            && let Some(ref ph) = entry.password_hash
                && verify_password(password, ph)? {
                    return Ok(Some(entry.name.clone()));
                }
    }
    Ok(None)
}

/// Check bearer token against a list of entries in a group.
pub fn check_token_auth(entries: &[AuthEntry], token: &str) -> Option<String> {
    for entry in entries {
        if entry.kind != AuthEntryKind::Token {
            continue;
        }
        if let Some(ref th) = entry.token_hash
            && verify_token(token, th) {
                return Some(entry.name.clone());
            }
    }
    None
}

/// Parse a basic auth header value ("Basic base64(user:pass)").
pub fn parse_basic_auth_header(header_value: &str) -> Option<(String, String)> {
    let encoded = header_value.strip_prefix("Basic ")?;
    let decoded = BASE64.decode(encoded).ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;
    let (user, pass) = decoded_str.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
}

/// Parse a bearer token header value ("Bearer <token>").
pub fn parse_bearer_auth_header(header_value: &str) -> Option<String> {
    header_value
        .strip_prefix("Bearer ")
        .map(|t| t.to_string())
}
