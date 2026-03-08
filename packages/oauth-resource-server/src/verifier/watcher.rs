use std::{path::PathBuf, sync::Arc, time::SystemTime};

use tokio::{
    sync::RwLock,
    task::JoinHandle,
    time::{Duration, sleep},
};
use tracing::{debug, warn};

use crate::{
    OAuthResourceServerJweConfig, models::LocalJweDecryptionKeySet,
    verifier::jwe::load_jwe_decryption_keys,
};

#[derive(Debug, Clone)]
struct WatchedFileState {
    path: PathBuf,
    fingerprint: Option<FileFingerprint>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileFingerprint {
    modified_at: SystemTime,
    len: u64,
}

pub(super) fn spawn_jwe_key_watcher(
    config: OAuthResourceServerJweConfig,
    decryption_keys: Arc<RwLock<Option<LocalJweDecryptionKeySet>>>,
) -> Option<JoinHandle<()>> {
    if config.watch_interval_seconds == 0 {
        return None;
    }

    let watched_files = watched_files_from_config(&config);
    if watched_files.is_empty() {
        return None;
    }

    Some(tokio::spawn(async move {
        let mut watched_files = initialize_watch_state(watched_files).await;
        let interval = Duration::from_secs(config.watch_interval_seconds);

        loop {
            sleep(interval).await;
            if !files_changed(&mut watched_files).await {
                continue;
            }

            match load_jwe_decryption_keys(&config).await {
                Ok(updated) => {
                    *decryption_keys.write().await = updated;
                    debug!("Reloaded JWE decryption keys after file rotation");
                }
                Err(error) => {
                    warn!(error = %error, "Failed to reload rotated JWE decryption keys");
                }
            }
        }
    }))
}

#[cfg(feature = "jwe")]
fn watched_files_from_config(config: &OAuthResourceServerJweConfig) -> Vec<PathBuf> {
    [
        config.jwe_jwks_path.as_deref(),
        config.jwe_jwk_path.as_deref(),
        config.jwe_pem_path.as_deref(),
    ]
    .into_iter()
    .flatten()
    .map(PathBuf::from)
    .collect()
}

async fn initialize_watch_state(paths: Vec<PathBuf>) -> Vec<WatchedFileState> {
    let mut result = Vec::with_capacity(paths.len());
    for path in paths {
        let fingerprint = file_fingerprint(&path).await;
        result.push(WatchedFileState { path, fingerprint });
    }
    result
}

async fn files_changed(watched_files: &mut [WatchedFileState]) -> bool {
    let mut changed = false;
    for watched_file in watched_files {
        let fingerprint = file_fingerprint(&watched_file.path).await;
        if fingerprint != watched_file.fingerprint {
            watched_file.fingerprint = fingerprint;
            changed = true;
        }
    }
    changed
}

async fn file_fingerprint(path: &PathBuf) -> Option<FileFingerprint> {
    let metadata = tokio::fs::metadata(path).await.ok()?;
    Some(FileFingerprint {
        modified_at: metadata.modified().ok()?,
        len: metadata.len(),
    })
}
