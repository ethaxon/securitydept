use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use chrono::Utc;
use fs2::FileExt;
use notify::{RecursiveMode, Watcher};
use securitydept_creds::{Argon2BasicAuthCred, Sha256TokenAuthCred, generate_token};
use snafu::ResultExt;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::error::{self, CredsManageResult};
use crate::models::{AuthEntry, AuthEntryMeta, BasicAuthEntry, DataFile, Group, TokenAuthEntry};

/// File-backed store for auth entries and groups.
///
/// The store keeps an in-memory cache and synchronizes it with disk:
/// - Writes are protected by an OS-level file lock.
/// - External file changes are ingested via FS events.
/// - If FS events are unavailable, we fall back to 1s polling.
pub struct CredsManageStore {
    path: PathBuf,
    data: Arc<RwLock<DataFile>>,
    last_modified: Arc<RwLock<Option<SystemTime>>>,
    io_lock: Arc<Mutex<()>>,
    sync_task: JoinHandle<()>,
}

impl CredsManageStore {
    /// Load (or create) the data file and return a Store.
    pub async fn load(path: impl AsRef<Path>) -> CredsManageResult<Self> {
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
        let data = self.data.read().await;
        collect_all_entries(&data)
    }

    pub async fn get_entry(&self, id: &str) -> CredsManageResult<AuthEntry> {
        let data = self.data.read().await;
        find_entry_by_id(&data, id)
            .ok_or_else(|| error::CredsManageError::EntryNotFound { id: id.to_string() })
    }

    pub async fn create_basic_entry(
        &self,
        name: String,
        username: String,
        password: String,
        group_ids: Vec<String>,
    ) -> CredsManageResult<AuthEntry> {
        let _io_guard = self.io_lock.lock().await;

        let (created, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                ensure_entry_name_is_unique(data, &name, None)?;
                ensure_groups_exist(data, &group_ids)?;

                let entry = BasicAuthEntry {
                    cred: Argon2BasicAuthCred::new(username, password)?,
                    meta: AuthEntryMeta::new(name, group_ids),
                };

                let created = AuthEntry::from(&entry);
                data.basic_creds.push(entry);
                Ok(created)
            })
            .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(created)
    }

    pub async fn create_token_entry(
        &self,
        name: String,
        group_ids: Vec<String>,
    ) -> CredsManageResult<(AuthEntry, String)> {
        let _io_guard = self.io_lock.lock().await;

        let (created, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                ensure_entry_name_is_unique(data, &name, None)?;
                ensure_groups_exist(data, &group_ids)?;

                let token = generate_token()?;
                let entry = TokenAuthEntry {
                    cred: Sha256TokenAuthCred::new(token.clone())?,
                    meta: AuthEntryMeta::new(name, group_ids),
                };

                let created = AuthEntry::from(&entry);
                data.token_creds.push(entry);
                Ok((created, token))
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
        password: Option<String>,
        group_ids: Option<Vec<String>>,
    ) -> CredsManageResult<AuthEntry> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (updated, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                if let Some(ref new_name) = name {
                    ensure_entry_name_is_unique(data, new_name, Some(&id))?;
                }
                if let Some(ref gids) = group_ids {
                    ensure_groups_exist(data, gids)?;
                }

                if let Some(entry) = data.basic_creds.iter_mut().find(|e| e.meta.id == id) {
                    if let Some(new_name) = name.clone() {
                        entry.meta.name = new_name;
                    }
                    if let Some(new_username) = username {
                        entry.cred.username = new_username;
                    }
                    if let Some(new_password) = password {
                        entry.cred.update_password(new_password)?;
                    }
                    if let Some(gids) = group_ids.clone() {
                        entry.meta.group_ids = gids;
                    }
                    entry.meta.updated_at = Utc::now();
                    return Ok(AuthEntry::from(&*entry));
                }

                if let Some(entry) = data.token_creds.iter_mut().find(|e| e.meta.id == id) {
                    if let Some(new_name) = name {
                        entry.meta.name = new_name;
                    }
                    if let Some(gids) = group_ids {
                        entry.meta.group_ids = gids;
                    }
                    entry.meta.updated_at = Utc::now();
                    return Ok(AuthEntry::from(&*entry));
                }

                Err(error::CredsManageError::EntryNotFound { id })
            })
            .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(updated)
    }

    pub async fn delete_entry(&self, id: &str) -> CredsManageResult<()> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (_, snapshot, modified) = mutate_data_file_with_lock(self.path.clone(), move |data| {
            let basic_len_before = data.basic_creds.len();
            data.basic_creds.retain(|e| e.meta.id != id);

            let token_len_before = data.token_creds.len();
            data.token_creds.retain(|e| e.meta.id != id);

            if data.basic_creds.len() == basic_len_before
                && data.token_creds.len() == token_len_before
            {
                return Err(error::CredsManageError::EntryNotFound { id: id.clone() });
            }

            Ok(())
        })
        .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(())
    }

    /// Find all entry metadata that belong to a given group id.
    pub async fn entries_by_group_id(&self, group_id: &str) -> Vec<AuthEntry> {
        let data = self.data.read().await;

        let mut entries = Vec::new();
        entries.extend(
            data.basic_creds
                .iter()
                .filter(|e| e.meta.group_ids.iter().any(|g| g == group_id))
                .map(AuthEntry::from),
        );
        entries.extend(
            data.token_creds
                .iter()
                .filter(|e| e.meta.group_ids.iter().any(|g| g == group_id))
                .map(AuthEntry::from),
        );
        entries
    }

    /// Find all basic auth entries that belong to a given group id.
    pub async fn basic_entries_by_group_id(&self, group_id: &str) -> Vec<BasicAuthEntry> {
        let data = self.data.read().await;
        data.basic_creds
            .iter()
            .filter(|e| e.meta.group_ids.iter().any(|g| g == group_id))
            .cloned()
            .collect()
    }

    /// Find all token auth entries that belong to a given group id.
    pub async fn token_entries_by_group_id(&self, group_id: &str) -> Vec<TokenAuthEntry> {
        let data = self.data.read().await;
        data.token_creds
            .iter()
            .filter(|e| e.meta.group_ids.iter().any(|g| g == group_id))
            .cloned()
            .collect()
    }

    // -- Group operations --

    pub async fn list_groups(&self) -> Vec<Group> {
        self.data.read().await.groups.clone()
    }

    pub async fn get_group(&self, id: &str) -> CredsManageResult<Group> {
        let data = self.data.read().await;
        data.groups
            .iter()
            .find(|g| g.id == id)
            .cloned()
            .ok_or_else(|| error::CredsManageError::GroupNotFound { id: id.to_string() })
    }

    pub async fn create_group(
        &self,
        group: Group,
        entry_ids: Option<Vec<String>>,
    ) -> CredsManageResult<Group> {
        let _io_guard = self.io_lock.lock().await;
        let group_for_write = group.clone();
        let entry_ids = entry_ids.unwrap_or_default();

        let (created, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                if data.groups.iter().any(|g| g.name == group_for_write.name) {
                    return Err(error::CredsManageError::DuplicateGroupName {
                        name: group_for_write.name.clone(),
                    });
                }

                for entry_id in &entry_ids {
                    if !entry_exists(data, entry_id) {
                        return Err(error::CredsManageError::EntryNotFound {
                            id: entry_id.clone(),
                        });
                    }
                }

                data.groups.push(group_for_write.clone());
                if !entry_ids.is_empty() {
                    for entry in &mut data.basic_creds {
                        if entry_ids.iter().any(|id| id == &entry.meta.id)
                            && !entry
                                .meta
                                .group_ids
                                .iter()
                                .any(|gid| gid == &group_for_write.id)
                        {
                            entry.meta.group_ids.push(group_for_write.id.clone());
                            entry.meta.updated_at = Utc::now();
                        }
                    }
                    for entry in &mut data.token_creds {
                        if entry_ids.iter().any(|id| id == &entry.meta.id)
                            && !entry
                                .meta
                                .group_ids
                                .iter()
                                .any(|gid| gid == &group_for_write.id)
                        {
                            entry.meta.group_ids.push(group_for_write.id.clone());
                            entry.meta.updated_at = Utc::now();
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
    ) -> CredsManageResult<Group> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();
        let selected_entry_ids = entry_ids;

        let (updated, snapshot, modified) =
            mutate_data_file_with_lock(self.path.clone(), move |data| {
                if data.groups.iter().any(|g| g.id != id && g.name == name) {
                    return Err(error::CredsManageError::DuplicateGroupName { name: name.clone() });
                }

                if let Some(ref entry_ids) = selected_entry_ids {
                    for entry_id in entry_ids {
                        if !entry_exists(data, entry_id) {
                            return Err(error::CredsManageError::EntryNotFound {
                                id: entry_id.clone(),
                            });
                        }
                    }
                }

                let target_group_id = {
                    let group =
                        data.groups.iter_mut().find(|g| g.id == id).ok_or_else(|| {
                            error::CredsManageError::GroupNotFound { id: id.clone() }
                        })?;
                    group.name = name;
                    group.id.clone()
                };

                for entry in &mut data.basic_creds {
                    let was_member = entry.meta.group_ids.iter().any(|g| g == &target_group_id);
                    let target_member = if let Some(ref entry_ids) = selected_entry_ids {
                        entry_ids.iter().any(|entry_id| entry_id == &entry.meta.id)
                    } else {
                        was_member
                    };
                    update_group_membership(&mut entry.meta, &target_group_id, target_member);
                }

                for entry in &mut data.token_creds {
                    let was_member = entry.meta.group_ids.iter().any(|g| g == &target_group_id);
                    let target_member = if let Some(ref entry_ids) = selected_entry_ids {
                        entry_ids.iter().any(|entry_id| entry_id == &entry.meta.id)
                    } else {
                        was_member
                    };
                    update_group_membership(&mut entry.meta, &target_group_id, target_member);
                }

                data.groups
                    .iter()
                    .find(|g| g.id == id)
                    .cloned()
                    .ok_or_else(|| error::CredsManageError::GroupNotFound { id: id.clone() })
            })
            .await?;

        *self.data.write().await = snapshot;
        *self.last_modified.write().await = modified;
        Ok(updated)
    }

    pub async fn delete_group(&self, id: &str) -> CredsManageResult<()> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (_, snapshot, modified) = mutate_data_file_with_lock(self.path.clone(), move |data| {
            let removed_group = data.groups.iter().find(|g| g.id == id).cloned();
            let Some(removed_group) = removed_group else {
                return Err(error::CredsManageError::GroupNotFound { id: id.clone() });
            };

            data.groups.retain(|g| g.id != id);

            for entry in &mut data.basic_creds {
                let len_before = entry.meta.group_ids.len();
                entry.meta.group_ids.retain(|gid| gid != &removed_group.id);
                if entry.meta.group_ids.len() != len_before {
                    entry.meta.updated_at = Utc::now();
                }
            }
            for entry in &mut data.token_creds {
                let len_before = entry.meta.group_ids.len();
                entry.meta.group_ids.retain(|gid| gid != &removed_group.id);
                if entry.meta.group_ids.len() != len_before {
                    entry.meta.updated_at = Utc::now();
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

impl Drop for CredsManageStore {
    fn drop(&mut self) {
        self.sync_task.abort();
    }
}

fn collect_all_entries(data: &DataFile) -> Vec<AuthEntry> {
    let mut entries = Vec::new();
    entries.extend(data.basic_creds.iter().map(AuthEntry::from));
    entries.extend(data.token_creds.iter().map(AuthEntry::from));
    entries.sort_by_key(|e| e.meta.created_at);
    entries
}

fn find_entry_by_id(data: &DataFile, id: &str) -> Option<AuthEntry> {
    if let Some(entry) = data.basic_creds.iter().find(|e| e.meta.id == id) {
        return Some(AuthEntry::from(entry));
    }
    if let Some(entry) = data.token_creds.iter().find(|e| e.meta.id == id) {
        return Some(AuthEntry::from(entry));
    }
    None
}

fn ensure_entry_name_is_unique(
    data: &DataFile,
    candidate_name: &str,
    current_entry_id: Option<&str>,
) -> CredsManageResult<()> {
    let exists_in_basic = data
        .basic_creds
        .iter()
        .any(|e| e.meta.name == candidate_name && current_entry_id != Some(e.meta.id.as_str()));

    let exists_in_token = data
        .token_creds
        .iter()
        .any(|e| e.meta.name == candidate_name && current_entry_id != Some(e.meta.id.as_str()));

    if exists_in_basic || exists_in_token {
        return Err(error::CredsManageError::DuplicateEntryName {
            name: candidate_name.to_string(),
        });
    }

    Ok(())
}

fn ensure_groups_exist(data: &DataFile, group_ids: &[String]) -> CredsManageResult<()> {
    for group_id in group_ids {
        if !data.groups.iter().any(|g| &g.id == group_id) {
            return Err(error::CredsManageError::GroupNotFound {
                id: group_id.clone(),
            });
        }
    }
    Ok(())
}

fn entry_exists(data: &DataFile, entry_id: &str) -> bool {
    data.basic_creds.iter().any(|e| e.meta.id == entry_id)
        || data.token_creds.iter().any(|e| e.meta.id == entry_id)
}

fn update_group_membership(meta: &mut AuthEntryMeta, target_group_id: &str, target_member: bool) {
    let before = meta.group_ids.clone();
    meta.group_ids
        .retain(|group_id| group_id != target_group_id);
    if target_member {
        meta.group_ids.push(target_group_id.to_string());
        meta.group_ids.sort();
        meta.group_ids.dedup();
    }

    if meta.group_ids != before {
        meta.updated_at = Utc::now();
    }
}

async fn run_notify_loop(
    path: PathBuf,
    data: Arc<RwLock<DataFile>>,
    last_modified: Arc<RwLock<Option<SystemTime>>>,
    io_lock: Arc<Mutex<()>>,
) -> std::result::Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<notify::Result<notify::Event>>();

    let mut watcher = notify::recommended_watcher(move |event| {
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
) -> CredsManageResult<()> {
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

async fn read_data_file_with_lock(
    path: PathBuf,
) -> CredsManageResult<(DataFile, Option<SystemTime>)> {
    let (content, modified) =
        tokio::task::spawn_blocking(move || -> std::io::Result<(String, Option<SystemTime>)> {
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
) -> CredsManageResult<(T, DataFile, Option<SystemTime>)>
where
    T: Send + 'static,
    F: FnOnce(&mut DataFile) -> CredsManageResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(
        move || -> CredsManageResult<(T, DataFile, Option<SystemTime>)> {
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

            let result = (|| -> CredsManageResult<(T, DataFile, Option<SystemTime>)> {
                file.seek(SeekFrom::Start(0))
                    .context(error::DataReadSnafu)?;
                let mut content = String::new();
                file.read_to_string(&mut content)
                    .context(error::DataReadSnafu)?;

                let mut data = parse_data_file(&content)?;
                let op_result = op(&mut data)?;

                let serialized =
                    serde_json::to_string_pretty(&data).context(error::DataSerializeSnafu)?;
                file.set_len(0).context(error::DataWriteSnafu)?;
                file.seek(SeekFrom::Start(0))
                    .context(error::DataWriteSnafu)?;
                file.write_all(serialized.as_bytes())
                    .context(error::DataWriteSnafu)?;
                file.sync_all().context(error::DataWriteSnafu)?;

                let modified = file.metadata().ok().and_then(|m| m.modified().ok());
                Ok((op_result, data, modified))
            })();

            let _ = file.unlock();
            result
        },
    )
    .await
    .expect("store mutate task panicked")
}

fn parse_data_file(content: &str) -> CredsManageResult<DataFile> {
    if content.trim().is_empty() {
        return Ok(DataFile::default());
    }

    serde_json::from_str(content).context(error::DataParseSnafu)
}
