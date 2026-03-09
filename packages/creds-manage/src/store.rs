use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use arc_swap::ArcSwap;
use atomic_write_file::AtomicWriteFile;
use chrono::Utc;
use fs2::FileExt;
use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use securitydept_creds::{Argon2BasicAuthCred, Sha256TokenAuthCred, generate_static_token};
use sha2::{Digest, Sha256};
use snafu::ResultExt;
use tokio::{
    sync::Mutex,
    task::JoinHandle,
};

use crate::{
    error::{self, CredsManageResult},
    models::{AuthEntry, AuthEntryMeta, BasicAuthEntry, DataFile, Group, TokenAuthEntry},
};

fn content_hash(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// File-backed store for auth entries and groups.
///
/// The store keeps an in-memory snapshot and synchronizes it with disk:
/// - Reads use `ArcSwap` for lock-free access.
/// - Writes are serialized via an async mutex and use atomic file replacement.
/// - External file changes are ingested via debounced FS events.
/// - If FS events are unavailable, we fall back to 1s polling.
/// - Self-writes are detected via content hash to avoid recursive reloads.
pub struct CredsManageStore {
    path: PathBuf,
    data: Arc<ArcSwap<DataFile>>,
    /// Guards all write operations so only one mutate runs at a time.
    io_lock: Arc<Mutex<()>>,
    /// After a successful save(), we record the hash of what we just wrote.
    /// The watcher checks incoming file content against this to skip one
    /// self-triggered event and then clears the marker.
    last_committed_hash: Arc<Mutex<Option<[u8; 32]>>>,
    sync_task: JoinHandle<()>,
}

impl CredsManageStore {
    /// Load (or create) the data file and return a Store.
    pub async fn load(path: impl AsRef<Path>) -> CredsManageResult<Self> {
        let path = path.as_ref().to_path_buf();
        let initial_data = read_data_file_with_lock(&path).await?;

        let data = Arc::new(ArcSwap::from_pointee(initial_data));
        let io_lock = Arc::new(Mutex::new(()));
        let last_committed_hash: Arc<Mutex<Option<[u8; 32]>>> = Arc::new(Mutex::new(None));

        let sync_task = Self::spawn_sync_task(
            path.clone(),
            Arc::clone(&data),
            Arc::clone(&last_committed_hash),
        );

        Ok(Self {
            path,
            data,
            io_lock,
            last_committed_hash,
            sync_task,
        })
    }

    fn spawn_sync_task(
        path: PathBuf,
        data: Arc<ArcSwap<DataFile>>,
        last_committed_hash: Arc<Mutex<Option<[u8; 32]>>>,
    ) -> JoinHandle<()> {
        tokio::spawn(async move {
            match run_debounced_watch(
                path.clone(),
                Arc::clone(&data),
                Arc::clone(&last_committed_hash),
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
                    run_poll_loop(path, data, last_committed_hash).await;
                }
            }
        })
    }

    // -- Entry operations --

    pub async fn list_entries(&self) -> Vec<AuthEntry> {
        let data = self.data.load();
        collect_all_entries(&data)
    }

    pub async fn get_entry(&self, id: &str) -> CredsManageResult<AuthEntry> {
        let data = self.data.load();
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

        let (created, snapshot) =
            atomic_mutate_data_file(
                &self.path,
                &self.last_committed_hash,
                move |data| {
                    ensure_entry_name_is_unique(data, &name, None)?;
                    ensure_groups_exist(data, &group_ids)?;

                    let entry = BasicAuthEntry {
                        cred: Argon2BasicAuthCred::new(username, password)?,
                        meta: AuthEntryMeta::new(name, group_ids),
                    };

                    let created = AuthEntry::from(&entry);
                    data.basic_creds.push(entry);
                    Ok(created)
                },
            )
            .await?;

        self.data.store(Arc::new(snapshot));
        Ok(created)
    }

    pub async fn create_token_entry(
        &self,
        name: String,
        group_ids: Vec<String>,
    ) -> CredsManageResult<(AuthEntry, String)> {
        let _io_guard = self.io_lock.lock().await;

        let (created, snapshot) =
            atomic_mutate_data_file(
                &self.path,
                &self.last_committed_hash,
                move |data| {
                    ensure_entry_name_is_unique(data, &name, None)?;
                    ensure_groups_exist(data, &group_ids)?;

                    let token = generate_static_token()?;
                    let entry = TokenAuthEntry {
                        cred: Sha256TokenAuthCred::new(token.clone())?,
                        meta: AuthEntryMeta::new(name, group_ids),
                    };

                    let created = AuthEntry::from(&entry);
                    data.token_creds.push(entry);
                    Ok((created, token))
                },
            )
            .await?;

        self.data.store(Arc::new(snapshot));
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

        let (updated, snapshot) =
            atomic_mutate_data_file(
                &self.path,
                &self.last_committed_hash,
                move |data| {
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
                },
            )
            .await?;

        self.data.store(Arc::new(snapshot));
        Ok(updated)
    }

    pub async fn delete_entry(&self, id: &str) -> CredsManageResult<()> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (_, snapshot) =
            atomic_mutate_data_file(
                &self.path,
                &self.last_committed_hash,
                move |data| {
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
                },
            )
            .await?;

        self.data.store(Arc::new(snapshot));
        Ok(())
    }

    /// Find all entry metadata that belong to a given group id.
    pub async fn entries_by_group_id(&self, group_id: &str) -> Vec<AuthEntry> {
        let data = self.data.load();

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
        let data = self.data.load();
        data.basic_creds
            .iter()
            .filter(|e| e.meta.group_ids.iter().any(|g| g == group_id))
            .cloned()
            .collect()
    }

    /// Find all token auth entries that belong to a given group id.
    pub async fn token_entries_by_group_id(&self, group_id: &str) -> Vec<TokenAuthEntry> {
        let data = self.data.load();
        data.token_creds
            .iter()
            .filter(|e| e.meta.group_ids.iter().any(|g| g == group_id))
            .cloned()
            .collect()
    }

    // -- Group operations --

    pub async fn list_groups(&self) -> Vec<Group> {
        self.data.load().groups.clone()
    }

    pub async fn get_group(&self, id: &str) -> CredsManageResult<Group> {
        let data = self.data.load();
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

        let (created, snapshot) =
            atomic_mutate_data_file(
                &self.path,
                &self.last_committed_hash,
                move |data| {
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
                },
            )
            .await?;

        self.data.store(Arc::new(snapshot));
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

        let (updated, snapshot) =
            atomic_mutate_data_file(
                &self.path,
                &self.last_committed_hash,
                move |data| {
                    if data.groups.iter().any(|g| g.id != id && g.name == name) {
                        return Err(error::CredsManageError::DuplicateGroupName {
                            name: name.clone(),
                        });
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
                        let was_member =
                            entry.meta.group_ids.iter().any(|g| g == &target_group_id);
                        let target_member = if let Some(ref entry_ids) = selected_entry_ids {
                            entry_ids.iter().any(|entry_id| entry_id == &entry.meta.id)
                        } else {
                            was_member
                        };
                        update_group_membership(
                            &mut entry.meta,
                            &target_group_id,
                            target_member,
                        );
                    }

                    for entry in &mut data.token_creds {
                        let was_member =
                            entry.meta.group_ids.iter().any(|g| g == &target_group_id);
                        let target_member = if let Some(ref entry_ids) = selected_entry_ids {
                            entry_ids.iter().any(|entry_id| entry_id == &entry.meta.id)
                        } else {
                            was_member
                        };
                        update_group_membership(
                            &mut entry.meta,
                            &target_group_id,
                            target_member,
                        );
                    }

                    data.groups
                        .iter()
                        .find(|g| g.id == id)
                        .cloned()
                        .ok_or_else(|| error::CredsManageError::GroupNotFound { id: id.clone() })
                },
            )
            .await?;

        self.data.store(Arc::new(snapshot));
        Ok(updated)
    }

    pub async fn delete_group(&self, id: &str) -> CredsManageResult<()> {
        let _io_guard = self.io_lock.lock().await;
        let id = id.to_string();

        let (_, snapshot) =
            atomic_mutate_data_file(
                &self.path,
                &self.last_committed_hash,
                move |data| {
                    let removed_group = data.groups.iter().find(|g| g.id == id).cloned();
                    let Some(removed_group) = removed_group else {
                        return Err(error::CredsManageError::GroupNotFound { id: id.clone() });
                    };

                    data.groups.retain(|g| g.id != id);

                    for entry in &mut data.basic_creds {
                        let len_before = entry.meta.group_ids.len();
                        entry
                            .meta
                            .group_ids
                            .retain(|gid| gid != &removed_group.id);
                        if entry.meta.group_ids.len() != len_before {
                            entry.meta.updated_at = Utc::now();
                        }
                    }
                    for entry in &mut data.token_creds {
                        let len_before = entry.meta.group_ids.len();
                        entry
                            .meta
                            .group_ids
                            .retain(|gid| gid != &removed_group.id);
                        if entry.meta.group_ids.len() != len_before {
                            entry.meta.updated_at = Utc::now();
                        }
                    }
                    Ok(())
                },
            )
            .await?;

        self.data.store(Arc::new(snapshot));
        Ok(())
    }

    /// Find a group by name.
    pub async fn find_group_by_name(&self, name: &str) -> Option<Group> {
        let data = self.data.load();
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

// ---------------------------------------------------------------------------
// Watcher: debounced FS events on the parent directory
// ---------------------------------------------------------------------------

/// Start a debounced FS watcher on the parent directory of `path`.
/// Returns `Err` if the watcher cannot be created.
async fn run_debounced_watch(
    path: PathBuf,
    data: Arc<ArcSwap<DataFile>>,
    last_committed_hash: Arc<Mutex<Option<[u8; 32]>>>,
) -> Result<(), String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<DebounceEventResult>();

    let target_path = path.canonicalize().map_err(|e| e.to_string())?;
    let watch_dir = target_path
        .parent()
        .ok_or_else(|| "data file has no parent directory".to_string())?
        .to_path_buf();

    let mut debouncer: Debouncer<notify::RecommendedWatcher, RecommendedCache> =
        new_debouncer(
            Duration::from_secs(1),
            None,
            move |event: DebounceEventResult| {
                let _ = tx.send(event);
            },
        )
        .map_err(|e| e.to_string())?;

    debouncer
        .watch(&watch_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    tracing::info!(path = %path.display(), "filesystem watch enabled for store file (parent dir)");

    while let Some(event) = rx.recv().await {
        let events = match event {
            Ok(events) => events,
            Err(errs) => {
                for err in errs {
                    tracing::warn!(error = %err, "filesystem watch event error");
                }
                continue;
            }
        };

        let target_touched = events.iter().any(|e| {
            e.event
                .paths
                .iter()
                .any(|p| is_same_file(p, &target_path))
        });

        if !target_touched {
            continue;
        }

        if let Err(err) = reload_if_external(
            &path,
            &data,
            &last_committed_hash,
        )
        .await
        {
            tracing::warn!(path = %path.display(), error = %err, "failed to sync store cache from disk");
        }
    }

    // Keep debouncer alive; if we reach here the channel closed.
    drop(debouncer);
    Err("filesystem watch channel closed".to_string())
}

fn is_same_file(a: &Path, b: &Path) -> bool {
    // Try canonical comparison; fall back to name comparison.
    if let (Ok(ac), Ok(bc)) = (a.canonicalize(), b.canonicalize()) {
        return ac == bc;
    }
    a.file_name() == b.file_name()
}

// ---------------------------------------------------------------------------
// Fallback: 1-second polling
// ---------------------------------------------------------------------------

async fn run_poll_loop(
    path: PathBuf,
    data: Arc<ArcSwap<DataFile>>,
    last_committed_hash: Arc<Mutex<Option<[u8; 32]>>>,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        if let Err(err) = reload_if_external(
            &path,
            &data,
            &last_committed_hash,
        )
        .await
        {
            tracing::warn!(path = %path.display(), error = %err, "polling sync failed");
        }
    }
}

// ---------------------------------------------------------------------------
// Reload: read file, check hash, publish new snapshot
// ---------------------------------------------------------------------------

async fn reload_if_external(
    path: &Path,
    data: &ArcSwap<DataFile>,
    last_committed_hash: &Mutex<Option<[u8; 32]>>,
) -> CredsManageResult<()> {
    let raw = read_raw_file_with_lock(path).await?;
    let hash = content_hash(&raw);

    // Check self-write marker
    {
        let mut committed = last_committed_hash.lock().await;
        if *committed == Some(hash) {
            // This is the file we just wrote ourselves — skip once.
            *committed = None;
            return Ok(());
        }
    }

    let disk_data = parse_data_file_bytes(&raw)?;

    // Only swap if content actually changed.
    let current_serialized =
        serde_json::to_string_pretty(&**data.load()).unwrap_or_default();
    if content_hash(current_serialized.as_bytes()) == hash {
        return Ok(());
    }

    data.store(Arc::new(disk_data));
    tracing::info!(path = %path.display(), "store cache synced from external file change");
    Ok(())
}

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

/// Read the data file contents under a shared (read) lock.
async fn read_raw_file_with_lock(path: &Path) -> CredsManageResult<Vec<u8>> {
    let path = path.to_path_buf();
    tokio::task::spawn_blocking(move || -> CredsManageResult<Vec<u8>> {
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            std::fs::create_dir_all(parent).context(error::DataReadSnafu)?;
        }

        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .context(error::DataReadSnafu)?;

        file.lock_shared().context(error::DataReadSnafu)?;
        let result = std::fs::read(&path).context(error::DataReadSnafu);
        let _ = file.unlock();
        result
    })
    .await
    .expect("store read task panicked")
}

/// Read and parse the data file.
async fn read_data_file_with_lock(path: &Path) -> CredsManageResult<DataFile> {
    let raw = read_raw_file_with_lock(path).await?;
    parse_data_file_bytes(&raw)
}

/// Atomically read-modify-write the data file.
///
/// 1. Read current file under exclusive lock.
/// 2. Apply the mutation closure.
/// 3. Serialize → temp file → fsync → rename (via `AtomicWriteFile`).
/// 4. Record the content hash so the watcher can skip the self-event.
async fn atomic_mutate_data_file<T, F>(
    path: &Path,
    last_committed_hash: &Mutex<Option<[u8; 32]>>,
    op: F,
) -> CredsManageResult<(T, DataFile)>
where
    T: Send + 'static,
    F: FnOnce(&mut DataFile) -> CredsManageResult<T> + Send + 'static,
{
    let path = path.to_path_buf();
    let (op_result, data, serialized_bytes) = tokio::task::spawn_blocking(
        move || -> CredsManageResult<(T, DataFile, Vec<u8>)> {
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                std::fs::create_dir_all(parent).context(error::DataWriteSnafu)?;
            }

            // Acquire an exclusive lock on the target file for the duration
            // of read + write. This prevents concurrent writers from
            // interleaving.
            let lock_file = std::fs::OpenOptions::new()
                .read(true)
                .write(true)
                .create(true)
                .truncate(false)
                .open(&path)
                .context(error::DataWriteSnafu)?;

            lock_file
                .lock_exclusive()
                .context(error::DataWriteSnafu)?;

            let result = (|| -> CredsManageResult<(T, DataFile, Vec<u8>)> {
                let content = std::fs::read_to_string(&path)
                    .context(error::DataReadSnafu)?;

                let mut data = parse_data_file(&content)?;
                let op_result = op(&mut data)?;

                let serialized =
                    serde_json::to_string_pretty(&data).context(error::DataSerializeSnafu)?;
                let serialized_bytes = serialized.into_bytes();

                // Atomic write: temp file → fsync → rename
                let mut atomic_file =
                    AtomicWriteFile::options().open(&path).context(error::DataWriteSnafu)?;
                atomic_file
                    .write_all(&serialized_bytes)
                    .context(error::DataWriteSnafu)?;
                atomic_file.flush().context(error::DataWriteSnafu)?;
                atomic_file.commit().context(error::DataWriteSnafu)?;

                Ok((op_result, data, serialized_bytes))
            })();

            let _ = lock_file.unlock();
            result
        },
    )
    .await
    .expect("store mutate task panicked")?;

    // Record the hash only after a successful write.
    *last_committed_hash.lock().await = Some(content_hash(&serialized_bytes));

    Ok((op_result, data))
}

fn parse_data_file(content: &str) -> CredsManageResult<DataFile> {
    if content.trim().is_empty() {
        return Ok(DataFile::default());
    }

    serde_json::from_str(content).context(error::DataParseSnafu)
}

fn parse_data_file_bytes(content: &[u8]) -> CredsManageResult<DataFile> {
    if content.is_empty() || content.iter().all(|b| b.is_ascii_whitespace()) {
        return Ok(DataFile::default());
    }

    serde_json::from_slice(content).context(error::DataParseSnafu)
}
