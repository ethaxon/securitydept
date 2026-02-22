use std::fmt::{Debug, Formatter};

use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, rand_core::OsRng},
};
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use serde::{Deserialize, Serialize};

use crate::{CredsError, CredsResult};

/// Parse a basic auth header value ("Basic base64(user:pass)").
pub fn parse_basic_auth_header_opt(header_value: &str) -> Option<(String, String)> {
    let encoded = header_value.strip_prefix("Basic ")?;
    let decoded = BASE64.decode(encoded).ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;
    let (user, pass) = decoded_str.split_once(':')?;
    Some((user.to_string(), pass.to_string()))
}

/// Parse a basic auth header value ("Basic base64(user:pass)") with error handling.
pub fn parse_basic_auth_header(header_value: &str) -> Result<(String, String), CredsError> {
    let encoded = header_value.strip_prefix("Basic ").ok_or_else(|| {
        CredsError::InvalidCredentialsFormat {
            message: "Authorization header must have 'Basic' scheme and credentials for basic auth"
                .to_string(),
        }
    })?;

    let decoded = BASE64
        .decode(encoded)
        .map_err(|e| CredsError::InvalidCredentialsFormat {
            message: format!("Failed to decode credentials: {}", e),
        })?;

    let decoded_str =
        String::from_utf8(decoded).map_err(|e| CredsError::InvalidCredentialsFormat {
            message: format!("Credentials contain invalid UTF-8: {}", e),
        })?;

    let (username, password) =
        decoded_str
            .split_once(':')
            .ok_or_else(|| CredsError::InvalidCredentialsFormat {
                message: "Missing username or password".to_string(),
            })?;

    Ok((username.to_string(), password.to_string()))
}

/// Hash a plaintext password with argon2.
pub fn hash_password_argon2(password: &str) -> CredsResult<String> {
    let salt = argon2::password_hash::SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| CredsError::PasswordHash {
            message: e.to_string(),
        })?;
    Ok(hash.to_string())
}

/// Verify a plaintext password against an argon2 hash.
pub fn verify_password_argon2(password: &str, password_hash: &str) -> CredsResult<bool> {
    let parsed = PasswordHash::new(password_hash).map_err(|e| CredsError::PasswordHash {
        message: e.to_string(),
    })?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok())
}

pub trait BasicAuthCred {
    fn username(&self) -> &str;
    fn display_name(&self) -> &str {
        self.username()
    }
    fn verify_password(&self, password: &str) -> CredsResult<bool>;
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Argon2BasicAuthCred {
    pub username: String,
    pub password_hash: String,
}

impl Argon2BasicAuthCred {
    pub fn new(username: String, password: String) -> CredsResult<Self> {
        let password_hash = hash_password_argon2(&password)?;
        Ok(Self {
            username,
            password_hash,
        })
    }

    pub fn update_password(&mut self, password: String) -> CredsResult<()> {
        self.password_hash = hash_password_argon2(&password)?;
        Ok(())
    }
}

impl Debug for Argon2BasicAuthCred {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Argon2BasicAuthCreds")
            .field("username", &self.username)
            .finish()
    }
}

impl BasicAuthCred for Argon2BasicAuthCred {
    fn username(&self) -> &str {
        &self.username
    }

    fn verify_password(&self, password: &str) -> CredsResult<bool> {
        verify_password_argon2(password, &self.password_hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify_password() {
        let password = "test_password_123";
        let hash = hash_password_argon2(password).unwrap();
        assert!(verify_password_argon2(password, &hash).unwrap());
        assert!(!verify_password_argon2("wrong_password", &hash).unwrap());
    }

    #[test]
    fn test_parse_basic_auth_header() {
        let credentials = BASE64.encode("username:password");
        let header = format!("Basic {}", credentials);
        let (user, pass) = parse_basic_auth_header_opt(&header).unwrap();
        assert_eq!(user, "username");
        assert_eq!(pass, "password");
    }

    #[test]
    fn test_parse_authorization_header() -> CredsResult<()> {
        // admin:secret123 encoded in base64
        let header = "Basic YWRtaW46c2VjcmV0MTIz";
        let (username, password) = parse_basic_auth_header(header)?;
        assert_eq!(username, "admin");
        assert_eq!(password, "secret123");
        Ok(())
    }

    #[test]
    fn test_parse_invalid_header() {
        assert!(parse_basic_auth_header("invalid").is_err());
        assert!(parse_basic_auth_header("Bearer token").is_err());
        assert!(parse_basic_auth_header("Basic invalid-base64").is_err());
    }
}
