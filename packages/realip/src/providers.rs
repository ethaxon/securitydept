use std::{
    collections::HashMap,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};

use ipnet::IpNet;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tokio::{
    process::Command,
    sync::{RwLock, watch},
    task::JoinHandle,
    time::{sleep, timeout},
};
use tracing::{debug, warn};

use crate::{
    config::{ProviderConfig, RefreshFailurePolicy, parse_ip_or_cidr},
    error::{RealIpError, RealIpResult},
};

#[derive(Debug, Clone)]
pub struct ProviderSnapshot {
    pub cidrs: Arc<Vec<IpNet>>,
    pub updated_at: Instant,
    pub stale_after: Option<Duration>,
}

impl ProviderSnapshot {
    fn new(cidrs: Vec<IpNet>, stale_after: Option<Duration>) -> Self {
        Self {
            cidrs: Arc::new(cidrs),
            updated_at: Instant::now(),
            stale_after,
        }
    }
}

#[derive(Debug)]
pub struct ProviderRegistry {
    state: Arc<RwLock<HashMap<String, ProviderSnapshot>>>,
    tasks: Vec<JoinHandle<()>>,
    _watchers: Vec<RecommendedWatcher>,
}

impl ProviderRegistry {
    pub async fn from_configs(configs: &[ProviderConfig]) -> RealIpResult<Self> {
        let state = Arc::new(RwLock::new(HashMap::new()));
        let mut tasks = Vec::new();
        let mut watchers = Vec::new();

        for config in configs {
            let snapshot = load_provider(config).await?;
            state
                .write()
                .await
                .insert(config.name.clone(), snapshot.clone());

            if let Some(handle) = spawn_refresh_task(config.clone(), state.clone()) {
                tasks.push(handle);
            }

            if config.kind == "local-file"
                && config.watch
                && let Some(watcher) = spawn_file_watcher(config.clone(), state.clone())?
            {
                watchers.push(watcher);
            }
        }

        Ok(Self {
            state,
            tasks,
            _watchers: watchers,
        })
    }

    pub async fn snapshot(&self, name: &str) -> Option<ProviderSnapshot> {
        self.state.read().await.get(name).cloned()
    }

    pub async fn all_cidrs(&self) -> Vec<IpNet> {
        self.state
            .read()
            .await
            .values()
            .flat_map(|snapshot| snapshot.cidrs.iter().copied())
            .collect()
    }
}

impl Drop for ProviderRegistry {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn spawn_refresh_task(
    config: ProviderConfig,
    state: Arc<RwLock<HashMap<String, ProviderSnapshot>>>,
) -> Option<JoinHandle<()>> {
    let refresh = match config.kind.as_str() {
        "remote-file" | "command" => config.refresh,
        _ => None,
    }?;

    Some(tokio::spawn(async move {
        loop {
            sleep(refresh).await;
            if let Err(error) = refresh_provider(&config, &state).await {
                warn!(provider = %config.name, error = %error, "Failed to refresh real-ip provider");
            }
        }
    }))
}

fn spawn_file_watcher(
    config: ProviderConfig,
    state: Arc<RwLock<HashMap<String, ProviderSnapshot>>>,
) -> RealIpResult<Option<RecommendedWatcher>> {
    let path = match &config.path {
        Some(path) => path.clone(),
        None => return Ok(None),
    };
    let debounce = config.debounce.unwrap_or(Duration::from_secs(2));
    let handle = tokio::runtime::Handle::current();
    let (tx, mut rx) = watch::channel(());

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|error| RealIpError::WatchProvider {
        path: path.clone(),
        details: error.to_string(),
    })?;
    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|error| RealIpError::WatchProvider {
            path: path.clone(),
            details: error.to_string(),
        })?;

    handle.spawn(async move {
        while rx.changed().await.is_ok() {
            sleep(debounce).await;
            if let Err(error) = refresh_provider(&config, &state).await {
                warn!(provider = %config.name, error = %error, "Failed to refresh watched local-file provider");
            }
        }
    });

    Ok(Some(watcher))
}

async fn refresh_provider(
    config: &ProviderConfig,
    state: &Arc<RwLock<HashMap<String, ProviderSnapshot>>>,
) -> RealIpResult<()> {
    match load_provider(config).await {
        Ok(snapshot) => {
            state.write().await.insert(config.name.clone(), snapshot);
            debug!(provider = %config.name, "Refreshed real-ip provider");
            Ok(())
        }
        Err(error) => {
            if matches!(config.on_refresh_failure, RefreshFailurePolicy::Clear) {
                state.write().await.remove(&config.name);
            }
            Err(error)
        }
    }
}

async fn load_provider(config: &ProviderConfig) -> RealIpResult<ProviderSnapshot> {
    let cidrs = match config.kind.as_str() {
        "inline" => config.cidrs.clone(),
        "local-file" => parse_entries(&config.name, &read_local_file(config).await?)?,
        "remote-file" => parse_entries(&config.name, &read_remote_file(config).await?)?,
        "command" => parse_entries(&config.name, &run_command_provider(config).await?)?,
        other => {
            return Err(RealIpError::UnknownProviderKind {
                name: config.name.clone(),
                kind: other.to_string(),
            });
        }
    };

    if cidrs.is_empty() {
        return Err(RealIpError::EmptyProviderOutput {
            provider: config.name.clone(),
        });
    }

    Ok(ProviderSnapshot::new(cidrs, config.max_stale))
}

async fn read_local_file(config: &ProviderConfig) -> RealIpResult<String> {
    let path = config.path.clone().expect("validated path");
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|source| RealIpError::ReadProviderFile { path, source })
}

async fn read_remote_file(config: &ProviderConfig) -> RealIpResult<String> {
    let url = config.url.clone().expect("validated url");
    let mut builder = reqwest::Client::builder();
    if let Some(timeout) = config.timeout {
        builder = builder.timeout(timeout);
    }
    let client = builder
        .build()
        .map_err(|source| RealIpError::ProviderHttp {
            url: url.clone(),
            source,
        })?;
    let response = client
        .get(&url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|source| RealIpError::ProviderHttp {
            url: url.clone(),
            source,
        })?;
    response
        .text()
        .await
        .map_err(|source| RealIpError::ProviderHttp { url, source })
}

async fn run_command_provider(config: &ProviderConfig) -> RealIpResult<String> {
    let command = config.command.clone().expect("validated command");
    let mut child = Command::new(&command);
    child.args(&config.args);
    child.stdout(Stdio::piped());
    child.stderr(Stdio::piped());

    let output = if let Some(limit) = config.timeout {
        timeout(limit, child.output())
            .await
            .map_err(|_| RealIpError::ProviderCommand {
                command: command.clone(),
                details: format!("timed out after {:?}", limit),
            })?
            .map_err(|error| RealIpError::ProviderCommand {
                command: command.clone(),
                details: error.to_string(),
            })?
    } else {
        child
            .output()
            .await
            .map_err(|error| RealIpError::ProviderCommand {
                command: command.clone(),
                details: error.to_string(),
            })?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(RealIpError::ProviderCommand {
            command,
            details: stderr.trim().to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_entries(provider: &str, content: &str) -> RealIpResult<Vec<IpNet>> {
    let mut cidrs = Vec::new();
    for raw_line in content.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }

        for entry in line
            .split(|ch: char| ch == ',' || ch.is_ascii_whitespace())
            .filter(|entry| !entry.is_empty())
        {
            let cidr = parse_ip_or_cidr(entry).map_err(|_| RealIpError::InvalidProviderEntry {
                provider: provider.to_string(),
                entry: entry.to_string(),
            })?;
            cidrs.push(cidr);
        }
    }

    Ok(cidrs)
}
