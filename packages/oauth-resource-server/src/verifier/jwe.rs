use std::sync::Arc;

use josekit::jwk::{
    Jwk, JwkSet, KeyAlg, KeyInfo, KeyPair,
    alg::{ec::EcKeyPair, ecx::EcxKeyPair, ed::EdKeyPair, rsa::RsaKeyPair},
};
use securitydept_creds::{
    JwtClaimsTrait, JwtValidation, TokenData, verify_token_rfc9068_with_jwks,
};
use tokio::{sync::RwLock, task::JoinHandle};

use crate::{
    LocalJweDecryptionKeySet, OAuthResourceServerError, OAuthResourceServerJweConfig,
    OAuthResourceServerMetadata, OAuthResourceServerResult, VerificationPolicy,
    verifier::{apply_validation_policy, watcher::spawn_jwe_key_watcher},
};

pub(super) struct OAuthResourceServerVerifierJwe {
    pub(super) decryption_keys: Arc<RwLock<Option<LocalJweDecryptionKeySet>>>,
    watcher_handle: Option<JoinHandle<()>>,
}

impl OAuthResourceServerVerifierJwe {
    pub async fn from_config(
        config: &OAuthResourceServerJweConfig,
    ) -> OAuthResourceServerResult<Self> {
        let decryption_keys = Arc::new(RwLock::new(load_jwe_decryption_keys(config).await?));
        let watcher_handle = spawn_jwe_key_watcher(config.clone(), Arc::clone(&decryption_keys));
        Ok(Self {
            decryption_keys,
            watcher_handle,
        })
    }

    pub async fn verify_token_data<CLAIMS>(
        &self,
        token: &str,
        jwt_jwks: &openidconnect::core::CoreJsonWebKeySet,
        metadata: &OAuthResourceServerMetadata,
        policy: &VerificationPolicy,
    ) -> OAuthResourceServerResult<TokenData<CLAIMS>>
    where
        CLAIMS: JwtClaimsTrait,
    {
        let jwe_guard = self.decryption_keys.read().await;
        let Some(jwe_jwks) = jwe_guard.as_ref() else {
            return Err(OAuthResourceServerError::UnsupportedTokenFormat {
                token_format: securitydept_creds::TokenFormat::JWE,
            });
        };

        verify_token_rfc9068_with_jwks(
            token,
            jwt_jwks,
            jwe_jwks,
            |mut validation: JwtValidation| {
                apply_validation_policy(&mut validation, metadata, policy);
                Ok(validation)
            },
        )
        .map_err(|source| OAuthResourceServerError::TokenValidation { source })
    }
}

impl Drop for OAuthResourceServerVerifierJwe {
    fn drop(&mut self) {
        if let Some(handle) = &self.watcher_handle {
            handle.abort();
        }
    }
}

pub(super) async fn load_jwe_decryption_keys(
    config: &OAuthResourceServerJweConfig,
) -> OAuthResourceServerResult<Option<LocalJweDecryptionKeySet>> {
    let mut keys = Vec::new();

    if let Some(path) = config.jwe_jwks_path.as_deref() {
        keys.extend(load_jwks_file(path).await?);
    }
    if let Some(path) = config.jwe_jwk_path.as_deref() {
        keys.push(load_jwk_file(path).await?);
    }
    if let Some(path) = config.jwe_pem_path.as_deref() {
        keys.push(load_pem_file(path, config).await?);
    }

    if keys.is_empty() {
        Ok(None)
    } else {
        Ok(Some(LocalJweDecryptionKeySet::new(keys)))
    }
}

async fn load_jwks_file(path: &str) -> OAuthResourceServerResult<Vec<Jwk>> {
    let data = read_key_file(path, "JWE JWKS").await?;
    let key_set = JwkSet::from_bytes(&data).map_err(|e| OAuthResourceServerError::JweKey {
        message: format!("Failed to parse JWE JWKS file '{path}': {e}"),
    })?;

    Ok(key_set.keys().into_iter().cloned().collect())
}

async fn load_jwk_file(path: &str) -> OAuthResourceServerResult<Jwk> {
    let data = read_key_file(path, "JWE JWK").await?;
    Jwk::from_bytes(&data).map_err(|e| OAuthResourceServerError::JweKey {
        message: format!("Failed to parse JWE JWK file '{path}': {e}"),
    })
}

async fn load_pem_file(
    path: &str,
    config: &OAuthResourceServerJweConfig,
) -> OAuthResourceServerResult<Jwk> {
    let data = read_key_file(path, "JWE PEM").await?;
    let key_info = KeyInfo::detect(&data).ok_or_else(|| OAuthResourceServerError::JweKey {
        message: format!("Failed to detect PEM key format for '{path}'"),
    })?;

    if key_info.is_public_key() {
        return Err(OAuthResourceServerError::JweKey {
            message: format!("PEM key file '{path}' must contain a private key"),
        });
    }

    let jwk = match key_info.alg() {
        Some(KeyAlg::Rsa | KeyAlg::RsaPss { .. }) => RsaKeyPair::from_pem(&data)
            .map_err(|e| OAuthResourceServerError::JweKey {
                message: format!("Failed to parse RSA PEM key '{path}': {e}"),
            })?
            .to_jwk_key_pair(),
        Some(KeyAlg::Ec { curve }) => EcKeyPair::from_pem(&data, curve)
            .map_err(|e| OAuthResourceServerError::JweKey {
                message: format!("Failed to parse EC PEM key '{path}': {e}"),
            })?
            .to_jwk_key_pair(),
        Some(KeyAlg::Ed { .. }) => EdKeyPair::from_pem(&data)
            .map_err(|e| OAuthResourceServerError::JweKey {
                message: format!("Failed to parse Ed PEM key '{path}': {e}"),
            })?
            .to_jwk_key_pair(),
        Some(KeyAlg::Ecx { .. }) => EcxKeyPair::from_pem(&data)
            .map_err(|e| OAuthResourceServerError::JweKey {
                message: format!("Failed to parse ECX PEM key '{path}': {e}"),
            })?
            .to_jwk_key_pair(),
        None => {
            return Err(OAuthResourceServerError::JweKey {
                message: format!("Unsupported PEM key type in '{path}'"),
            });
        }
    };

    Ok(apply_pem_metadata_overrides(jwk, config))
}

async fn read_key_file(path: &str, label: &str) -> OAuthResourceServerResult<Vec<u8>> {
    tokio::fs::read(path)
        .await
        .map_err(|e| OAuthResourceServerError::JweKey {
            message: format!("Failed to read {label} file '{path}': {e}"),
        })
}

fn apply_pem_metadata_overrides(mut jwk: Jwk, config: &OAuthResourceServerJweConfig) -> Jwk {
    if let Some(key_id) = config.jwe_pem_key_id.as_deref() {
        jwk.set_key_id(key_id);
    }
    if let Some(algorithm) = config.jwe_pem_algorithm.as_deref() {
        jwk.set_algorithm(algorithm);
    }
    if let Some(key_use) = config.jwe_pem_key_use.as_deref() {
        jwk.set_key_use(key_use);
    }
    jwk
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use josekit::jwk::alg::rsa::RsaKeyPair;
    use tokio::time::{Duration, sleep};

    use super::{load_jwe_decryption_keys, load_jwk_file, load_jwks_file, load_pem_file, OAuthResourceServerVerifierJwe};
    use crate::OAuthResourceServerJweConfig;

    fn temp_path(suffix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be monotonic")
            .as_nanos();
        std::env::temp_dir().join(format!("securitydept-oauth-rs-{nanos}.{suffix}"))
    }

    #[tokio::test]
    async fn load_single_jwk_file_works() {
        let path = temp_path("jwk");
        let jwk = josekit::jwk::Jwk::generate_oct_key(32).expect("oct key should generate");
        std::fs::write(&path, serde_json::to_vec(&jwk).expect("jwk should serialize"))
            .expect("jwk file should write");

        let loaded = load_jwk_file(path.to_str().expect("path should be valid"))
            .await
            .expect("single jwk should load");
        std::fs::remove_file(&path).expect("temp file should remove");

        assert_eq!(loaded.key_type(), "oct");
    }

    #[tokio::test]
    async fn load_jwks_file_works() {
        let path = temp_path("jwks");
        let mut jwk_set = josekit::jwk::JwkSet::new();
        jwk_set.push_key(josekit::jwk::Jwk::generate_oct_key(32).expect("oct key should generate"));
        std::fs::write(&path, jwk_set.to_string()).expect("jwks file should write");

        let loaded = load_jwks_file(path.to_str().expect("path should be valid"))
            .await
            .expect("jwks should load");
        std::fs::remove_file(&path).expect("temp file should remove");

        assert_eq!(loaded.len(), 1);
    }

    #[tokio::test]
    async fn load_pem_file_works() {
        let path = temp_path("pem");
        let pem = RsaKeyPair::generate(2048)
            .expect("rsa key should generate")
            .to_pem_private_key();
        std::fs::write(&path, pem).expect("pem file should write");

        let loaded = load_pem_file(
            path.to_str().expect("path should be valid"),
            &OAuthResourceServerJweConfig {
                jwe_pem_path: Some(path.to_string_lossy().into_owned()),
                ..Default::default()
            },
        )
        .await
        .expect("pem should load");
        std::fs::remove_file(&path).expect("temp file should remove");

        assert_eq!(loaded.key_type(), "RSA");
    }

    #[tokio::test]
    async fn load_pem_file_applies_metadata_overrides() {
        let path = temp_path("pem");
        let pem = RsaKeyPair::generate(2048)
            .expect("rsa key should generate")
            .to_pem_private_key();
        std::fs::write(&path, pem).expect("pem file should write");

        let loaded = load_pem_file(
            path.to_str().expect("path should be valid"),
            &OAuthResourceServerJweConfig {
                jwe_pem_path: Some(path.to_string_lossy().into_owned()),
                jwe_pem_key_id: Some("enc-key-1".to_string()),
                jwe_pem_algorithm: Some("RSA-OAEP-256".to_string()),
                jwe_pem_key_use: Some("enc".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("pem should load");
        std::fs::remove_file(&path).expect("temp file should remove");

        assert_eq!(loaded.key_id(), Some("enc-key-1"));
        assert_eq!(loaded.algorithm(), Some("RSA-OAEP-256"));
        assert_eq!(loaded.key_use(), Some("enc"));
    }

    #[tokio::test]
    async fn load_combined_key_sources_works() {
        let jwk_path = temp_path("jwk");
        let pem_path = temp_path("pem");

        let jwk = josekit::jwk::Jwk::generate_oct_key(32).expect("oct key should generate");
        std::fs::write(&jwk_path, serde_json::to_vec(&jwk).expect("jwk should serialize"))
            .expect("jwk file should write");

        let pem = RsaKeyPair::generate(2048)
            .expect("rsa key should generate")
            .to_pem_private_key();
        std::fs::write(&pem_path, pem).expect("pem file should write");

        let loaded = load_jwe_decryption_keys(&OAuthResourceServerJweConfig {
            jwe_jwk_path: Some(jwk_path.to_string_lossy().into_owned()),
            jwe_pem_path: Some(pem_path.to_string_lossy().into_owned()),
            ..Default::default()
        })
        .await
        .expect("combined sources should load")
        .expect("combined sources should produce keys");

        std::fs::remove_file(&jwk_path).expect("temp file should remove");
        std::fs::remove_file(&pem_path).expect("temp file should remove");

        assert_eq!(loaded.keys().len(), 2);
    }

    #[tokio::test]
    async fn watcher_reloads_rotated_keys() {
        let jwk_path = temp_path("jwk");
        let initial = josekit::jwk::Jwk::generate_oct_key(32).expect("oct key should generate");
        std::fs::write(&jwk_path, serde_json::to_vec(&initial).expect("jwk should serialize"))
            .expect("jwk file should write");

        let verifier = OAuthResourceServerVerifierJwe::from_config(&OAuthResourceServerJweConfig {
            jwe_jwk_path: Some(jwk_path.to_string_lossy().into_owned()),
            watch_interval_seconds: 1,
            ..Default::default()
        })
        .await
        .expect("jwe verifier should initialize");

        sleep(Duration::from_millis(200)).await;

        let updated = josekit::jwk::Jwk::generate_oct_key(64).expect("oct key should generate");
        std::fs::write(&jwk_path, serde_json::to_vec(&updated).expect("jwk should serialize"))
            .expect("rotated jwk file should write");

        let mut observed = None;
        for _ in 0..10 {
            sleep(Duration::from_millis(300)).await;
            let guard = verifier.decryption_keys.read().await;
            let current = guard.as_ref().expect("keys should still exist");
            if current.keys()[0].parameter("k") == updated.parameter("k") {
                observed = current.keys()[0].parameter("k").cloned();
                break;
            }
        }
        std::fs::remove_file(&jwk_path).expect("temp file should remove");

        assert_eq!(observed, updated.parameter("k").cloned());
    }
}
