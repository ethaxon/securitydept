use std::time::Duration;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
pub struct OAuthResourceServerJweConfig {
    /// Path to a local JWKS file containing one or more private keys used to
    /// decrypt JWE access tokens.
    ///
    /// Example:
    /// `{ "keys": [ { "kty": "RSA", "kid": "enc-1", "n": "...", "e": "...",
    /// "d": "...", "p": "...", "q": "...", "dp": "...", "dq": "...", "qi":
    /// "..." } ] }`
    #[serde(default)]
    pub jwe_jwks_path: Option<String>,
    /// Path to a local single JWK file containing one private key used to
    /// decrypt JWE access tokens.
    ///
    /// Example:
    /// `{ "kty": "oct", "kid": "enc-oct-1", "k": "base64url-secret" }`
    #[serde(default)]
    pub jwe_jwk_path: Option<String>,
    /// Path to a local PEM private key file used to decrypt JWE access tokens.
    ///
    /// Supported PEM inputs are auto-detected. RSA and EC private keys are the
    /// primary expected formats for JWE.
    #[serde(default)]
    pub jwe_pem_path: Option<String>,
    /// Optional `kid` override applied to the JWK derived from `jwe_pem_path`.
    #[serde(default)]
    pub jwe_pem_key_id: Option<String>,
    /// Optional `alg` override applied to the JWK derived from `jwe_pem_path`.
    #[serde(default)]
    pub jwe_pem_algorithm: Option<String>,
    /// Optional `use` override applied to the JWK derived from `jwe_pem_path`.
    #[serde(default)]
    pub jwe_pem_key_use: Option<String>,
    /// Poll interval for watching local JWE key files for key rotation.
    /// Set to `"0s"` to disable background watching.
    #[serde(default, with = "humantime_serde")]
    pub watch_interval: Duration,
}
