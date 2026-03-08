use std::path::PathBuf;

use securitydept_creds::{Argon2BasicAuthCred, Sha256TokenAuthCred};
use serde::{Deserialize, Serialize};
use snafu::ResultExt;

use crate::{
    CredsManageConfig, CredsManageResult, error,
    migrations::models::MigratorTrait,
    models::{AuthEntryKind, AuthEntryMeta, DATA_FILE_VERSION, DataFile, Group},
};

#[derive(Serialize, Deserialize)]
pub struct AuthEntryV1 {
    pub kind: AuthEntryKind,
    /// Username for basic auth entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Argon2 hash of the password for basic auth entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    /// SHA-256 hash of the token for token auth entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_hash: Option<String>,
    #[serde(flatten)]
    pub meta: AuthEntryMeta,
}

#[derive(Serialize, Deserialize)]
pub struct DataFileV1 {
    pub entries: Vec<AuthEntryV1>,
    pub groups: Vec<Group>,
}

pub type DataFileV2 = DataFile;
pub type DataFileCurrent = DataFile;

pub struct Migrator;

impl MigratorTrait for Migrator {
    fn up(&self, config: &CredsManageConfig, _steps: Option<u32>) -> CredsManageResult<()> {
        let path = PathBuf::from(&config.data_path);

        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent).context(error::DataWriteSnafu)?;
        }

        if !path.exists() {
            write_current_empty(&path)?;
            return Ok(());
        }

        let raw = std::fs::read_to_string(&path).context(error::DataReadSnafu)?;
        if raw.trim().is_empty() {
            write_current_empty(&path)?;
            return Ok(());
        }

        let value: serde_json::Value = serde_json::from_str(&raw).context(error::DataParseSnafu)?;
        let current_version = detect_version(&value);
        if current_version >= 2 {
            return Ok(());
        }
        if current_version != 1 {
            return Err(crate::CredsManageError::InvalidConfig {
                message: format!(
                    "Unsupported creds data file version: {} (expected 1 or 2)",
                    current_version
                ),
            });
        }

        let old: DataFileV1 = serde_json::from_value(value).context(error::DataParseSnafu)?;
        let migrated = migrate_v1_to_v2(old)?;

        let serialized =
            serde_json::to_string_pretty(&migrated).context(error::DataSerializeSnafu)?;
        std::fs::write(&path, serialized).context(error::DataWriteSnafu)?;
        Ok(())
    }
}

fn write_current_empty(path: &PathBuf) -> CredsManageResult<()> {
    let data = DataFileCurrent::default();
    let serialized = serde_json::to_string_pretty(&data).context(error::DataSerializeSnafu)?;
    std::fs::write(path, serialized).context(error::DataWriteSnafu)?;
    Ok(())
}

fn detect_version(value: &serde_json::Value) -> u32 {
    if let Some(version) = value.get("version").and_then(|v| v.as_u64()) {
        return version as u32;
    }

    // Legacy schema had no explicit version and used `entries`.
    if value.get("entries").is_some() { 1 } else { 0 }
}

fn migrate_v1_to_v2(old: DataFileV1) -> CredsManageResult<DataFileV2> {
    let mut basic_creds = Vec::new();
    let mut token_creds = Vec::new();

    for entry in old.entries {
        match entry.kind {
            AuthEntryKind::Basic => {
                let username =
                    entry
                        .username
                        .ok_or_else(|| crate::CredsManageError::InvalidConfig {
                            message: format!("basic entry {} missing username", entry.meta.id),
                        })?;
                let password_hash =
                    entry
                        .password_hash
                        .ok_or_else(|| crate::CredsManageError::InvalidConfig {
                            message: format!("basic entry {} missing password_hash", entry.meta.id),
                        })?;
                basic_creds.push(crate::models::BasicAuthEntry {
                    cred: Argon2BasicAuthCred {
                        username,
                        password_hash,
                    },
                    meta: entry.meta,
                });
            }
            AuthEntryKind::Token => {
                let token_hash =
                    entry
                        .token_hash
                        .ok_or_else(|| crate::CredsManageError::InvalidConfig {
                            message: format!("token entry {} missing token_hash", entry.meta.id),
                        })?;
                token_creds.push(crate::models::TokenAuthEntry {
                    cred: Sha256TokenAuthCred { token_hash },
                    meta: entry.meta,
                });
            }
        }
    }

    Ok(DataFileV2 {
        version: DATA_FILE_VERSION,
        groups: old.groups,
        basic_creds,
        token_creds,
    })
}
