use std::fmt::{Debug, Formatter};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use rand::TryRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    TokenAuthCred,
    error::{CredsError, CredsResult},
};

pub fn generate_static_token() -> CredsResult<String> {
    let mut bytes = [0u8; 32];
    rand::rng()
        .try_fill_bytes(&mut bytes)
        .map_err(|e| CredsError::RandomBytes {
            message: e.to_string(),
        })?;
    let token: String = BASE64.encode(bytes).to_string();
    Ok(token)
}

/// Hash a token with SHA-256 and return hex.
pub fn hash_token_sha256(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Verify a token against a stored SHA-256 hex hash.
pub fn verify_token_sha256(token: &str, stored_hash: &str) -> bool {
    hash_token_sha256(token) == stored_hash
}

pub trait StaticTokenAuthCred: TokenAuthCred {
    fn token_hash(&self) -> &str;
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Sha256TokenAuthCred {
    pub token_hash: String,
}

impl Sha256TokenAuthCred {
    pub fn new(token: String) -> CredsResult<Self> {
        let token_hash = hash_token_sha256(&token);
        Ok(Self { token_hash })
    }
}

impl Debug for Sha256TokenAuthCred {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Sha256TokenAuthCred")
            .field("token_hash", &self.token_hash[..5].to_string())
            .finish()
    }
}

impl TokenAuthCred for Sha256TokenAuthCred {
    fn verify_token(&self, token: &str) -> CredsResult<bool> {
        Ok(verify_token_sha256(token, &self.token_hash))
    }
}

impl StaticTokenAuthCred for Sha256TokenAuthCred {
    fn token_hash(&self) -> &str {
        &self.token_hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse_bearer_auth_header_opt;

    #[test]
    fn test_generate_and_verify_token() {
        let token = generate_static_token().unwrap();
        let hash = hash_token_sha256(&token);
        assert!(verify_token_sha256(&token, &hash));
        assert!(!verify_token_sha256("wrong_token", &hash));
    }

    #[test]
    fn test_parse_bearer_auth_header() {
        let header = "Bearer my_token_123";
        let token = parse_bearer_auth_header_opt(header).unwrap();
        assert_eq!(token, "my_token_123");
    }
}
