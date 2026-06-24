use std::sync::Arc;

use no_way_jose_core::jwk::{Jwk, JwkSet, KeyUse, ToJwk};
use no_way_jose_ecdh_es::{EcPrivateKey, ecdh_es};
use no_way_jose_rsa::rsa_oaep_256;
use rsa::{RsaPrivateKey, pkcs1::DecodeRsaPrivateKey, pkcs8::DecodePrivateKey};
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
    let key_set = JwkSet::from_json(&data).map_err(|e| OAuthResourceServerError::JweKey {
        message: format!("Failed to parse JWE JWKS file '{path}': {e}"),
    })?;

    Ok(key_set.keys)
}

async fn load_jwk_file(path: &str) -> OAuthResourceServerResult<Jwk> {
    let data = read_key_file(path, "JWE JWK").await?;
    Jwk::from_json(&data).map_err(|e| OAuthResourceServerError::JweKey {
        message: format!("Failed to parse JWE JWK file '{path}': {e}"),
    })
}

async fn load_pem_file(
    path: &str,
    config: &OAuthResourceServerJweConfig,
) -> OAuthResourceServerResult<Jwk> {
    let data = read_key_file(path, "JWE PEM").await?;
    let pem = std::str::from_utf8(&data).map_err(|e| OAuthResourceServerError::JweKey {
        message: format!("JWE PEM key '{path}' is not valid UTF-8: {e}"),
    })?;
    let jwk = parse_pem_private_key(pem).ok_or_else(|| OAuthResourceServerError::JweKey {
        message: format!(
            "Unsupported PEM private key in '{path}'; expected RSA PKCS#1/PKCS#8 or P-256/P-384 \
             SEC1/PKCS#8"
        ),
    })?;

    apply_pem_metadata_overrides(jwk, config)
}

fn parse_pem_private_key(pem: &str) -> Option<Jwk> {
    if let Some(private_key) = RsaPrivateKey::from_pkcs8_pem(pem)
        .ok()
        .or_else(|| RsaPrivateKey::from_pkcs1_pem(pem).ok())
    {
        let mut jwk = rsa_oaep_256::key(private_key).to_jwk();
        jwk.alg = None;
        return Some(jwk);
    }

    if let Ok(private_key) = p256::SecretKey::from_pem(pem) {
        let mut jwk = ecdh_es::key(EcPrivateKey::P256(private_key)).to_jwk();
        jwk.alg = None;
        return Some(jwk);
    }

    if let Ok(private_key) = p384::SecretKey::from_pem(pem) {
        let mut jwk = ecdh_es::key(EcPrivateKey::P384(private_key)).to_jwk();
        jwk.alg = None;
        return Some(jwk);
    }

    None
}

async fn read_key_file(path: &str, label: &str) -> OAuthResourceServerResult<Vec<u8>> {
    tokio::fs::read(path)
        .await
        .map_err(|e| OAuthResourceServerError::JweKey {
            message: format!("Failed to read {label} file '{path}': {e}"),
        })
}

fn apply_pem_metadata_overrides(
    mut jwk: Jwk,
    config: &OAuthResourceServerJweConfig,
) -> OAuthResourceServerResult<Jwk> {
    if let Some(key_id) = config.jwe_pem_key_id.as_deref() {
        jwk.kid = Some(key_id.to_string());
    }
    if let Some(algorithm) = config.jwe_pem_algorithm.as_deref() {
        jwk.alg = Some(algorithm.to_string());
    }
    if let Some(key_use) = config.jwe_pem_key_use.as_deref() {
        jwk.use_ = Some(match key_use {
            "enc" => KeyUse::Enc,
            "sig" => KeyUse::Sig,
            value => {
                return Err(OAuthResourceServerError::JweKey {
                    message: format!("Unsupported JWK use override '{value}'"),
                });
            }
        });
    }
    Ok(jwk)
}

#[cfg(test)]
mod tests {
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use no_way_jose_core::jwk::{Jwk, JwkParams, JwkSet, KeyUse, OctParams};
    use p256::elliptic_curve::Generate;
    use rsa::{
        RsaPrivateKey,
        pkcs8::{EncodePrivateKey, LineEnding},
    };
    use tokio::time::{Duration, sleep};

    use super::{
        OAuthResourceServerVerifierJwe, load_jwe_decryption_keys, load_jwk_file, load_jwks_file,
        load_pem_file,
    };
    use crate::OAuthResourceServerJweConfig;

    static TEMP_PATH_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_path(suffix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be monotonic")
            .as_nanos();
        let process_id = std::process::id();
        let counter = TEMP_PATH_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "securitydept-oauth-rs-{process_id}-{nanos}-{counter}.{suffix}"
        ))
    }

    fn oct_jwk(key: &[u8]) -> Jwk {
        Jwk {
            kid: None,
            alg: None,
            use_: Some(KeyUse::Enc),
            key_ops: None,
            key: JwkParams::Oct(OctParams { k: key.to_vec() }),
        }
    }

    fn oct_key(jwk: &Jwk) -> Option<&[u8]> {
        match &jwk.key {
            JwkParams::Oct(parameters) => Some(&parameters.k),
            _ => None,
        }
    }

    fn rsa_private_key_pem() -> String {
        RsaPrivateKey::new(&mut rand::rng(), 2048)
            .expect("rsa key should generate")
            .to_pkcs8_pem(LineEnding::LF)
            .expect("rsa key should encode")
            .to_string()
    }

    fn p256_private_key_pem() -> String {
        p256::SecretKey::generate()
            .to_pkcs8_pem(LineEnding::LF)
            .expect("P-256 key should encode")
            .to_string()
    }

    #[tokio::test]
    async fn load_single_jwk_file_works() {
        let path = temp_path("jwk");
        let jwk = oct_jwk(&[1; 32]);
        std::fs::write(&path, jwk.to_json()).expect("jwk file should write");

        let loaded = load_jwk_file(path.to_str().expect("path should be valid"))
            .await
            .expect("single jwk should load");
        std::fs::remove_file(&path).expect("temp file should remove");

        assert_eq!(loaded.kty(), "oct");
    }

    #[tokio::test]
    async fn load_jwks_file_works() {
        let path = temp_path("jwks");
        let jwk_set = JwkSet {
            keys: vec![oct_jwk(&[2; 32])],
        };
        std::fs::write(&path, jwk_set.to_json()).expect("jwks file should write");

        let loaded = load_jwks_file(path.to_str().expect("path should be valid"))
            .await
            .expect("jwks should load");
        std::fs::remove_file(&path).expect("temp file should remove");

        assert_eq!(loaded.len(), 1);
    }

    #[tokio::test]
    async fn load_pem_file_works() {
        let path = temp_path("pem");
        let pem = rsa_private_key_pem();
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

        assert_eq!(loaded.kty(), "RSA");
    }

    #[tokio::test]
    async fn load_p256_pem_file_works() {
        let path = temp_path("pem");
        std::fs::write(&path, p256_private_key_pem()).expect("pem file should write");

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

        assert_eq!(loaded.kty(), "EC");
    }

    #[tokio::test]
    async fn load_pem_file_applies_metadata_overrides() {
        let path = temp_path("pem");
        let pem = rsa_private_key_pem();
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

        assert_eq!(loaded.kid.as_deref(), Some("enc-key-1"));
        assert_eq!(loaded.alg.as_deref(), Some("RSA-OAEP-256"));
        assert_eq!(loaded.use_, Some(KeyUse::Enc));
    }

    #[tokio::test]
    async fn load_combined_key_sources_works() {
        let jwk_path = temp_path("jwk");
        let pem_path = temp_path("pem");

        let jwk = oct_jwk(&[3; 32]);
        std::fs::write(&jwk_path, jwk.to_json()).expect("jwk file should write");

        let pem = rsa_private_key_pem();
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
        let initial = oct_jwk(&[4; 32]);
        std::fs::write(&jwk_path, initial.to_json()).expect("jwk file should write");

        let verifier = OAuthResourceServerVerifierJwe::from_config(&OAuthResourceServerJweConfig {
            jwe_jwk_path: Some(jwk_path.to_string_lossy().into_owned()),
            watch_interval: Duration::from_secs(1),
            ..Default::default()
        })
        .await
        .expect("jwe verifier should initialize");

        sleep(Duration::from_millis(200)).await;

        let updated = oct_jwk(&[5; 64]);
        std::fs::write(&jwk_path, updated.to_json()).expect("rotated jwk file should write");

        let mut observed = None;
        for _ in 0..10 {
            sleep(Duration::from_millis(300)).await;
            let guard = verifier.decryption_keys.read().await;
            let current = guard.as_ref().expect("keys should still exist");
            if oct_key(&current.keys()[0]) == oct_key(&updated) {
                observed = oct_key(&current.keys()[0]).map(<[u8]>::to_vec);
                break;
            }
        }
        std::fs::remove_file(&jwk_path).expect("temp file should remove");

        assert_eq!(observed.as_deref(), oct_key(&updated));
    }
}
