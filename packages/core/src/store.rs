use std::path::{Path, PathBuf};

use chrono::Utc;
use snafu::ResultExt;
use tokio::sync::RwLock;

use crate::error::{self, Result};
use crate::models::{AuthEntry, DataFile, Group};

/// File-backed store for auth entries and groups.
pub struct Store {
    path: PathBuf,
    data: RwLock<DataFile>,
}

impl Store {
    /// Load (or create) the data file and return a Store.
    pub async fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let data = if path.exists() {
            let content = tokio::fs::read_to_string(&path)
                .await
                .context(error::DataReadSnafu)?;
            serde_json::from_str(&content).context(error::DataParseSnafu)?
        } else {
            DataFile::default()
        };

        Ok(Self {
            path,
            data: RwLock::new(data),
        })
    }

    /// Persist current state to disk.
    async fn save(&self, data: &DataFile) -> Result<()> {
        let content = serde_json::to_string_pretty(data).context(error::DataSerializeSnafu)?;
        tokio::fs::write(&self.path, content)
            .await
            .context(error::DataWriteSnafu)?;
        Ok(())
    }

    // ── Entry operations ──

    pub async fn list_entries(&self) -> Vec<AuthEntry> {
        self.data.read().await.entries.clone()
    }

    pub async fn get_entry(&self, id: &str) -> Result<AuthEntry> {
        let data = self.data.read().await;
        data.entries
            .iter()
            .find(|e| e.id == id)
            .cloned()
            .ok_or_else(|| error::Error::EntryNotFound { id: id.to_string() })
    }

    pub async fn create_entry(&self, entry: AuthEntry) -> Result<AuthEntry> {
        let mut data = self.data.write().await;

        // Check for duplicate names
        if data.entries.iter().any(|e| e.name == entry.name) {
            return Err(error::Error::DuplicateEntryName {
                name: entry.name.clone(),
            });
        }

        data.entries.push(entry.clone());
        self.save(&data).await?;
        Ok(entry)
    }

    pub async fn update_entry(
        &self,
        id: &str,
        name: Option<String>,
        username: Option<String>,
        password_hash: Option<String>,
        groups: Option<Vec<String>>,
    ) -> Result<AuthEntry> {
        let mut data = self.data.write().await;

        // Check name uniqueness before mutating
        if let Some(ref new_name) = name
            && data
                .entries
                .iter()
                .any(|e| e.id != id && e.name == *new_name)
            {
                return Err(error::Error::DuplicateEntryName {
                    name: new_name.clone(),
                });
            }

        let entry = data
            .entries
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| error::Error::EntryNotFound { id: id.to_string() })?;

        if let Some(new_name) = name {
            entry.name = new_name;
        }
        if let Some(u) = username {
            entry.username = Some(u);
        }
        if let Some(ph) = password_hash {
            entry.password_hash = Some(ph);
        }
        if let Some(g) = groups {
            entry.groups = g;
        }

        entry.updated_at = Utc::now();
        let updated = entry.clone();
        self.save(&data).await?;
        Ok(updated)
    }

    pub async fn delete_entry(&self, id: &str) -> Result<()> {
        let mut data = self.data.write().await;
        let len_before = data.entries.len();
        data.entries.retain(|e| e.id != id);
        if data.entries.len() == len_before {
            return Err(error::Error::EntryNotFound { id: id.to_string() });
        }
        self.save(&data).await?;
        Ok(())
    }

    /// Find all entries that belong to a given group.
    pub async fn entries_by_group(&self, group_name: &str) -> Vec<AuthEntry> {
        let data = self.data.read().await;
        data.entries
            .iter()
            .filter(|e| e.groups.iter().any(|g| g == group_name))
            .cloned()
            .collect()
    }

    // ── Group operations ──

    pub async fn list_groups(&self) -> Vec<Group> {
        self.data.read().await.groups.clone()
    }

    pub async fn get_group(&self, id: &str) -> Result<Group> {
        let data = self.data.read().await;
        data.groups
            .iter()
            .find(|g| g.id == id)
            .cloned()
            .ok_or_else(|| error::Error::GroupNotFound { id: id.to_string() })
    }

    pub async fn create_group(&self, group: Group) -> Result<Group> {
        let mut data = self.data.write().await;

        if data.groups.iter().any(|g| g.name == group.name) {
            return Err(error::Error::DuplicateGroupName {
                name: group.name.clone(),
            });
        }

        data.groups.push(group.clone());
        self.save(&data).await?;
        Ok(group)
    }

    pub async fn update_group(&self, id: &str, name: String) -> Result<Group> {
        let mut data = self.data.write().await;

        // Check name uniqueness
        if data.groups.iter().any(|g| g.id != id && g.name == name) {
            return Err(error::Error::DuplicateGroupName { name: name.clone() });
        }

        let group = data
            .groups
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| error::Error::GroupNotFound { id: id.to_string() })?;

        group.name = name;
        let updated = group.clone();
        self.save(&data).await?;
        Ok(updated)
    }

    pub async fn delete_group(&self, id: &str) -> Result<()> {
        let mut data = self.data.write().await;
        let len_before = data.groups.len();
        data.groups.retain(|g| g.id != id);
        if data.groups.len() == len_before {
            return Err(error::Error::GroupNotFound { id: id.to_string() });
        }
        self.save(&data).await?;
        Ok(())
    }

    /// Find a group by name.
    pub async fn find_group_by_name(&self, name: &str) -> Option<Group> {
        let data = self.data.read().await;
        data.groups.iter().find(|g| g.name == name).cloned()
    }
}
