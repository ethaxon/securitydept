use std::fmt;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use snafu::Snafu;

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(transparent)]
pub struct SealedRefreshMaterial(String);

impl SealedRefreshMaterial {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SealedRefreshMaterial {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SealedRefreshMaterial(REDACTED)")
    }
}

pub trait RefreshMaterialProtector: Send + Sync {
    fn seal(&self, refresh_token: &str) -> Result<SealedRefreshMaterial, RefreshMaterialError>;
    fn unseal(&self, material: &SealedRefreshMaterial) -> Result<String, RefreshMaterialError>;
}

#[derive(Debug, Snafu)]
pub enum RefreshMaterialError {
    #[snafu(display("refresh material protector is misconfigured: {message}"))]
    InvalidConfig { message: String },
    #[snafu(display("refresh material is invalid: {message}"))]
    InvalidMaterial { message: String },
    #[snafu(display("refresh material cryptographic operation failed: {message}"))]
    Cryptography { message: String },
}

#[derive(Debug, Default, Clone, Copy)]
pub struct PassthroughRefreshMaterialProtector;

impl RefreshMaterialProtector for PassthroughRefreshMaterialProtector {
    fn seal(&self, refresh_token: &str) -> Result<SealedRefreshMaterial, RefreshMaterialError> {
        Ok(SealedRefreshMaterial::new(refresh_token))
    }

    fn unseal(&self, material: &SealedRefreshMaterial) -> Result<String, RefreshMaterialError> {
        Ok(material.expose().to_string())
    }
}

pub struct AeadRefreshMaterialProtector {
    master_key: orion::aead::SecretKey,
}

impl fmt::Debug for AeadRefreshMaterialProtector {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("AeadRefreshMaterialProtector(REDACTED)")
    }
}

impl AeadRefreshMaterialProtector {
    pub fn from_master_key(master_key: &str) -> Result<Self, RefreshMaterialError> {
        let master_key =
            orion::aead::SecretKey::from_slice(master_key.as_bytes()).map_err(|e| {
                RefreshMaterialError::InvalidConfig {
                    message: format!("failed to parse master key: {e}"),
                }
            })?;

        Ok(Self { master_key })
    }
}

impl RefreshMaterialProtector for AeadRefreshMaterialProtector {
    fn seal(&self, refresh_token: &str) -> Result<SealedRefreshMaterial, RefreshMaterialError> {
        let ciphertext =
            orion::aead::seal(&self.master_key, refresh_token.as_bytes()).map_err(|e| {
                RefreshMaterialError::Cryptography {
                    message: format!("failed to seal refresh token: {e}"),
                }
            })?;

        Ok(SealedRefreshMaterial::new(
            URL_SAFE_NO_PAD.encode(ciphertext),
        ))
    }

    fn unseal(&self, material: &SealedRefreshMaterial) -> Result<String, RefreshMaterialError> {
        let ciphertext = URL_SAFE_NO_PAD.decode(material.expose()).map_err(|e| {
            RefreshMaterialError::InvalidMaterial {
                message: format!("failed to decode sealed refresh token: {e}"),
            }
        })?;

        let plaintext = orion::aead::open(&self.master_key, &ciphertext).map_err(|e| {
            RefreshMaterialError::Cryptography {
                message: format!("failed to unseal refresh token: {e}"),
            }
        })?;

        String::from_utf8(plaintext).map_err(|e| RefreshMaterialError::InvalidMaterial {
            message: format!("unsealed refresh token is not valid UTF-8: {e}"),
        })
    }
}
