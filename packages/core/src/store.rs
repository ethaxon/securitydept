use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::Utc;
use fs2::FileExt;
use notify::{RecursiveMode, Watcher};
use snafu::ResultExt;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::error::{self, Result};
use crate::models::{AuthEntry, DataFile, Group};

/// File-backed store for auth entries and groups.
///
/// The store keeps an in-memory cache and synchronizes it with disk:
/// - Writes are protected by an OS-level file lock.
/// - External file changes are ingested via FS events.
/// - If FS events are unavailable, we fall back to 1s polling.
pub struct Store {
    path: PathBuf,
    data: Arc<RwLock<DataFile>>,
    last_modified: Arc<RwLock<Option<SystemTime>>>,
    io_lock: Arc<Mutex<()>>,
    sync_task: JoinHandle<()>,
}

impl Store {
    /// Load (or create) the data file and return a Store.
    pub async fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let (initial_data, initial_modified) = read_data_file_with_lock(path.clone()).await?;

        let data = Arc::new(RwLock::new(initial_data));
        let last_modified = Arc::new(RwLock::new(initial_modified));
        let io_lock = Arc::new(Mutex::new(()));

        let sync_task = Self::spawn_sync_task(
            path.clone(),
            Arc::clone(&data),
            Arc::clone(&last_modified),
            Arc::clone(&io_lock),
        );

        Ok(Self {
            path,
            data,
            last_modified,
            io_lock,
            sync_task,
        })
    }

    fn spawn_sync_task(
        path: PathBuf,
        data: Arc<RwLock<DataFile>>,
        last_modified: Arc<RwLock<Option<SystemTime>>>,
        io_lock: Arc<Mutex<()>>,
    ) -> JoinHandle<()> {
        tokio::spawn(async move {
            match run_notify_loop(
                path.clone(),
                Arc::clone(&data),
                Arc::clone(&last_modified),
                Arc::clone(&io_lock),
            )
            .await
            {
                Ok(()) => {}
                Err(err) => {
                    tracing::warn!(
                        path = %path.display(),
                        error = %err,
                        "filesystem watch unavailable; fallback to 1s polling"
                    );
                    run_poll_loop(path, data, last_modified, io_lock).await;
                }
            }
        })
    }

    // -- Entry operations --

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
        let _io_guard = self.io_lock.lock().await;

        let entry_for_write = entry.clone();
        let (created, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                if data.entries.iter().any(|e| e.name == entry_for_write.name) {
                    return Err(error::Error::DuplicateEntryName {
                        name: entry_for_write.name.clone(),
                    });
                }
                for group_id in &entry_for_write.group_ids {
                    if !data.groups.iter().any(|g| &g.id == group_id) {
                        return Err(error::Error::GroupNotFound {
                            id: group_id.clone(),
                        });
                    }
                }

                data.entries.push(entry_for_write.clone());
                Ok(entry_for_write)
            })
            .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(created)
    }

    pub async fn update_entry(
        &self,
        id: &str,
        name: Option<String>,
        username: Option<String>,
        password_hash: Option<String>,
        group_ids: Option<Vec<String>>,
    ) -> Result<AuthEntry> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (updated, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                if let Some(ref new_name) = name
                    && data.entries.iter().any(|e| e.id != id && e.name == *new_name)
                {
                    return Err(error::Error::DuplicateEntryName {
                        name: new_name.clone(),
                    });
                }
                if let Some(ref gids) = group_ids {
                    for group_id in gids {
                        if !data.groups.iter().any(|g| &g.id == group_id) {
                            return Err(error::Error::GroupNotFound {
                                id: group_id.clone(),
                            });
                        }
                    }
                }

                let entry = data
                    .entries
                    .iter_mut()
                    .find(|e| e.id == id)
                    .ok_or_else(|| error::Error::EntryNotFound { id: id.clone() })?;

                if let Some(new_name) = name {
                    entry.name = new_name;
                }
                if let Some(u) = username {
                    entry.username = Some(u);
                }
                if let Some(ph) = password_hash {
                    entry.password_hash = Some(ph);
                }
                if let Some(gids) = group_ids {
                    entry.group_ids = gids;
                }

                entry.updated_at = Utc::now();
                Ok(entry.clone())
            })
            .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(updated)
    }

    pub async fn delete_entry(&self, id: &str) -> Result<()> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (_, snapshot, modified) = mutate_data_file_with_lock(self.path.clone(), move |data| {
            let len_before = data.entries.len();
            data.entries.retain(|e| e.id != id);
            if data.entries.len() == len_before {
                return Err(error::Error::EntryNotFound { id: id.clone() });
            }
            Ok(())
        })
        .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(())
    }

    /// Find all entries that belong to a given group id.
    pub async fn entries_by_group_id(&self, group_id: &str) -> Vec<AuthEntry> {
        let data = self.data.read().await;
        data.entries
            .iter()
            .filter(|e| e.group_ids.iter().any(|g| g == group_id))
            .cloned()
            .collect()
    }

    // -- Group operations --

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

    pub async fn create_group(&self, group: Group, entry_ids: Option<Vec<String>>) -> Result<Group> {
        let _io_guard = self.io_lock.lock().await;
        let group_for_write = group.clone();
        let entry_ids = entry_ids.unwrap_or_default();
        let (created, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                if data.groups.iter().any(|g| g.name == group_for_write.name) {
                    return Err(error::Error::DuplicateGroupName {
                        name: group_for_write.name.clone(),
                    });
                }

                for entry_id in &entry_ids {
                    if !data.entries.iter().any(|e| &e.id == entry_id) {
                        return Err(error::Error::EntryNotFound {
                            id: entry_id.clone(),
                        });
                    }
                }

                data.groups.push(group_for_write.clone());
                if !entry_ids.is_empty() {
                    for entry in &mut data.entries {
                        if entry_ids.iter().any(|id| id == &entry.id)
                            && !entry.group_ids.iter().any(|gid| gid == &group_for_write.id)
                        {
                            entry.group_ids.push(group_for_write.id.clone());
                            entry.updated_at = Utc::now();
                        }
                    }
                }
                Ok(group_for_write)
            })
            .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(created)
    }

    pub async fn update_group(
        &self,
        id: &str,
        name: String,
        entry_ids: Option<Vec<String>>,
    ) -> Result<Group> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();
        let selected_entry_ids = entry_ids;

        let (updated, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                if data.groups.iter().any(|g| g.id != id && g.name == name) {
                    return Err(error::Error::DuplicateGroupName { name: name.clone() });
                }

                if let Some(ref entry_ids) = selected_entry_ids {
                    for entry_id in entry_ids {
                        if !data.entries.iter().any(|e| &e.id == entry_id) {
                            return Err(error::Error::EntryNotFound {
                                id: entry_id.clone(),
                            });
                        }
                    }
                }

                let group = data
                    .groups
                    .iter_mut()
                    .find(|g| g.id == id)
                    .ok_or_else(|| error::Error::GroupNotFound { id: id.clone() })?;

                group.name = name;
                let target_group_id = group.id.clone();

                for entry in &mut data.entries {
                    let was_member = entry.group_ids.iter().any(|g| g == &target_group_id);
                    let target_member = if let Some(ref entry_ids) = selected_entry_ids {
                        entry_ids.iter().any(|entry_id| entry_id == &entry.id)
                    } else {
                        was_member
                    };

                    let before = entry.group_ids.clone();
                    entry.group_ids.retain(|g| g != &target_group_id);
                    if target_member {
                        entry.group_ids.push(target_group_id.clone());
                        entry.group_ids.sort();
                        entry.group_ids.dedup();
                    }

                    if entry.group_ids != before {
                        entry.updated_at = Utc::now();
                    }
                }
                Ok(group.clone())
            })
            .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(updated)
    }

    pub async fn delete_group(&self, id: &str) -> Result<()> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (_, snapshot, modified) = mutate_data_file_with_lock(self.path.clone(), move |data| {
            let removed_group = data.groups.iter().find(|g| g.id == id).cloned();
            let Some(removed_group) = removed_group else {
                return Err(error::Error::GroupNotFound { id: id.clone() });
            };

            data.groups.retain(|g| g.id != id);
            for entry in &mut data.entries {
                let len_before = entry.group_ids.len();
                entry.group_ids.retain(|gid| gid != &removed_group.id);
                if entry.group_ids.len() != len_before {
                    entry.updated_at = Utc::now();
                }
            }
            Ok(())
        })
        .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(())
    }

    /// Find a group by name.
    pub async fn find_group_by_name(&self, name: &str) -> Option<Group> {
        let data = self.data.read().await;
        data.groups.iter().find(|g| g.name == name).cloned()
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        self.sync_task.abort();
    }
}

async fn run_notify_loop(
    path: PathBuf,
    data: Arc<RwLock<DataFile>>,
    last_modified: Arc<RwLock<Option<SystemTime>>>,
    io_lock: Arc<Mutex<()>>,
) -> std::result::Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<notify::Result<notify::Event>>();

    let mut watcher =
        notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
        })
        .map_err(|e| e.to_string())?;

    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    tracing::info!(path = %path.display(), "filesystem watch enabled for store file");

    while let Some(event) = rx.recv().await {
        match event {
            Ok(_) => {
                if let Err(err) = reload_from_disk_if_changed(
                    &path,
                    Arc::clone(&data),
                    Arc::clone(&last_modified),
                    Arc::clone(&io_lock),
                )
                .await
                {
                    tracing::warn!(path = %path.display(), error = %err, "failed to sync store cache from disk");
                }
            }
            Err(err) => {
                tracing::warn!(path = %path.display(), error = %err, "filesystem watch event error");
            }
        }
    }

    Err("filesystem watch channel closed".to_string())
}

async fn run_poll_loop(
    path: PathBuf,
    data: Arc<RwLock<DataFile>>,
    last_modified: Arc<RwLock<Option<SystemTime>>>,
    io_lock: Arc<Mutex<()>>,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        if let Err(err) = reload_from_disk_if_changed(
            &path,
            Arc::clone(&data),
            Arc::clone(&last_modified),
            Arc::clone(&io_lock),
        )
        .await
        {
            tracing::warn!(path = %path.display(), error = %err, "polling sync failed");
        }
    }
}

async fn reload_from_disk_if_changed(
    path: &Path,
    data: Arc<RwLock<DataFile>>,
    last_modified: Arc<RwLock<Option<SystemTime>>>,
    io_lock: Arc<Mutex<()>>,
) -> Result<()> {
    let _io_guard = io_lock.lock().await;
    let (disk_data, disk_modified) = read_data_file_with_lock(path.to_path_buf()).await?;

    let cached_modified = *last_modified.read().await;
    if cached_modified == disk_modified {
        return Ok(());
    }

    *data.write().await = disk_data;
    *last_modified.write().await = disk_modified;
    tracing::info!(path = %path.display(), "store cache synced from external file change");
    Ok(())
}

async fn read_data_file_with_lock(path: PathBuf) -> Result<(DataFile, Option<SystemTime>)> {
    let (content, modified) = tokio::task::spawn_blocking(move || -> std::io::Result<(String, Option<SystemTime>)> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent)?;
        }

        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)?;

        file.lock_shared()?;

        let result = (|| {
            let modified = file.metadata().ok().and_then(|m| m.modified().ok());
            file.seek(SeekFrom::Start(0))?;
            let mut content = String::new();
            file.read_to_string(&mut content)?;
            Ok((content, modified))
        })();

        let unlock_result = file.unlock();
        match (result, unlock_result) {
            (Ok(value), Ok(())) => Ok(value),
            (Err(err), _) => Err(err),
            (Ok(_), Err(err)) => Err(err),
        }
    })
    .await
    .expect("store read task panicked")
    .context(error::DataReadSnafu)?;

    let data = parse_data_file(&content)?;
    Ok((data, modified))
}

async fn mutate_data_file_with_lock<T, F>(
    path: PathBuf,
    op: F,
) -> Result<(T, DataFile, Option<SystemTime>)>
where
    T: Send + 'static,
    F: FnOnce(&mut DataFile) -> Result<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || -> Result<(T, DataFile, Option<SystemTime>)> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent).context(error::DataWriteSnafu)?;
        }

        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .context(error::DataWriteSnafu)?;

        file.lock_exclusive().context(error::DataWriteSnafu)?;

        let result = (|| -> Result<(T, DataFile, Option<SystemTime>)> {
            file.seek(SeekFrom::Start(0)).context(error::DataReadSnafu)?;
            let mut content = String::new();
            file.read_to_string(&mut content).context(error::DataReadSnafu)?;

            let mut data = parse_data_file(&content)?;
            let op_result = op(&mut data)?;

            let serialized = serde_json::to_string_pretty(&data).context(error::DataSerializeSnafu)?;
            file.set_len(0).context(error::DataWriteSnafu)?;
            file.seek(SeekFrom::Start(0)).context(error::DataWriteSnafu)?;
            file.write_all(serialized.as_bytes())
                .context(error::DataWriteSnafu)?;
            file.sync_all().context(error::DataWriteSnafu)?;

            let modified = file.metadata().ok().and_then(|m| m.modified().ok());
            Ok((op_result, data, modified))
        })();

        let _ = file.unlock();
        result
    })
    .await
    .expect("store mutate task panicked")
}

fn parse_data_file(content: &str) -> Result<DataFile> {
    if content.trim().is_empty() {
        return Ok(DataFile::default());
    }

    serde_json::from_str(content).context(error::DataParseSnafu)
}
