use std::{
    collections::HashMap,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant},
};

use arc_swap::ArcSwap;
use ipnet::IpNet;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use tokio::{
    process::Command,
    sync::watch,
    task::JoinHandle,
    time::{sleep, timeout},
};
use tracing::{debug, warn};

use crate::{
    config::{CoreProviderConfig, ProviderConfig, RefreshFailurePolicy, parse_ip_or_cidr},
    error::{RealIpError, RealIpResult},
    extension::{DynamicProvider, ProviderFactoryRegistry},
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
    state: Arc<ArcSwap<ProviderState>>,
    tasks: Vec<JoinHandle<()>>,
    _watchers: Vec<RecommendedWatcher>,
}

#[derive(Debug, Default)]
struct ProviderState {
    by_name: HashMap<String, ProviderSnapshot>,
    all_cidrs: Vec<IpNet>,
}

impl ProviderRegistry {
    pub async fn from_configs(configs: &[ProviderConfig]) -> RealIpResult<Self> {
        let factories = ProviderFactoryRegistry::with_builtin_providers()?;
        Self::from_configs_with_factories(configs, &factories).await
    }

    pub async fn from_configs_with_factories(
        configs: &[ProviderConfig],
        factories: &ProviderFactoryRegistry,
    ) -> RealIpResult<Self> {
        let mut by_name = HashMap::new();
        let mut runtime_configs = Vec::with_capacity(configs.len());
        let mut tasks = Vec::new();
        let mut watchers = Vec::new();

        for config in configs {
            let custom_provider = build_custom_provider(config, factories)?;
            let snapshot = load_provider(config, custom_provider.as_deref()).await?;
            by_name.insert(config.name().to_string(), snapshot);
            runtime_configs.push((config.clone(), custom_provider));
        }

        let state = Arc::new(ArcSwap::from_pointee(ProviderState {
            all_cidrs: collect_all_cidrs(&by_name),
            by_name,
        }));

        for (config, custom_provider) in runtime_configs {
            if let Some(handle) =
                spawn_refresh_task(config.clone(), custom_provider.clone(), state.clone())
            {
                tasks.push(handle);
            }

            if let Some(watcher) = spawn_file_watcher(config, state.clone())? {
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
        self.state.load().by_name.get(name).cloned()
    }

    pub async fn all_cidrs(&self) -> Vec<IpNet> {
        self.state.load().all_cidrs.clone()
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
    custom_provider: Option<Arc<dyn DynamicProvider>>,
    state: Arc<ArcSwap<ProviderState>>,
) -> Option<JoinHandle<()>> {
    let refresh = config.refresh()?;

    Some(tokio::spawn(async move {
        loop {
            sleep(refresh).await;
            if let Err(error) = refresh_provider(&config, custom_provider.as_deref(), &state).await
            {
                warn!(provider = %config.name(), error = %error, "Failed to refresh real-ip provider");
            }
        }
    }))
}

fn spawn_file_watcher(
    config: ProviderConfig,
    state: Arc<ArcSwap<ProviderState>>,
) -> RealIpResult<Option<RecommendedWatcher>> {
    let (path, debounce) = match config.watch_path() {
        Some((path, debounce)) => (path.clone(), debounce),
        None => return Ok(None),
    };
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
            if let Err(error) = refresh_provider(&config, None, &state).await {
                warn!(provider = %config.name(), error = %error, "Failed to refresh watched local-file provider");
            }
        }
    });

    Ok(Some(watcher))
}

async fn refresh_provider(
    config: &ProviderConfig,
    custom_provider: Option<&dyn DynamicProvider>,
    state: &Arc<ArcSwap<ProviderState>>,
) -> RealIpResult<()> {
    match load_provider(config, custom_provider).await {
        Ok(snapshot) => {
            replace_provider_snapshot(state, config.name(), Some(snapshot));
            debug!(provider = %config.name(), "Refreshed real-ip provider");
            Ok(())
        }
        Err(error) => {
            if matches!(config.on_refresh_failure(), RefreshFailurePolicy::Clear) {
                replace_provider_snapshot(state, config.name(), None);
            }
            Err(error)
        }
    }
}

async fn load_provider(
    config: &ProviderConfig,
    custom_provider: Option<&dyn DynamicProvider>,
) -> RealIpResult<ProviderSnapshot> {
    let cidrs = match config {
        ProviderConfig::Core(CoreProviderConfig::Inline(config)) => config.cidrs.clone(),
        ProviderConfig::Core(CoreProviderConfig::LocalFile(_)) => {
            parse_entries(config.name(), &read_local_file(config).await?)?
        }
        ProviderConfig::Core(CoreProviderConfig::RemoteFile(_)) => {
            parse_entries(config.name(), &read_remote_file(config).await?)?
        }
        ProviderConfig::Core(CoreProviderConfig::Command(_)) => {
            parse_entries(config.name(), &run_command_provider(config).await?)?
        }
        ProviderConfig::Custom(config) => {
            custom_provider
                .ok_or_else(|| RealIpError::MissingProviderFactory {
                    kind: config.kind.clone(),
                })?
                .load()
                .await?
        }
    };

    if cidrs.is_empty() {
        return Err(RealIpError::EmptyProviderOutput {
            provider: config.name().to_string(),
        });
    }

    Ok(ProviderSnapshot::new(cidrs, config.max_stale()))
}

fn build_custom_provider(
    config: &ProviderConfig,
    factories: &ProviderFactoryRegistry,
) -> RealIpResult<Option<Arc<dyn DynamicProvider>>> {
    let Some(custom) = config.custom() else {
        return Ok(None);
    };
    let Some(factory) = factories.get(&custom.kind) else {
        return Err(RealIpError::MissingProviderFactory {
            kind: custom.kind.clone(),
        });
    };
    factory.create(custom).map(Some)
}

async fn read_local_file(config: &ProviderConfig) -> RealIpResult<String> {
    let path = config.local_file_path().expect("validated path").clone();
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|source| RealIpError::ReadProviderFile { path, source })
}

async fn read_remote_file(config: &ProviderConfig) -> RealIpResult<String> {
    let url = config.remote_file_url().expect("validated url").to_string();
    let mut builder = reqwest::Client::builder();
    if let Some(timeout) = config.timeout() {
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
    let (command, args) = config.command_spec().expect("validated command");
    let command = command.to_string();
    let mut child = Command::new(&command);
    child.args(args);
    child.stdout(Stdio::piped());
    child.stderr(Stdio::piped());

    let output = if let Some(limit) = config.timeout() {
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

fn replace_provider_snapshot(
    state: &Arc<ArcSwap<ProviderState>>,
    name: &str,
    snapshot: Option<ProviderSnapshot>,
) {
    let current = state.load();
    let mut by_name = current.by_name.clone();
    match snapshot {
        Some(snapshot) => {
            by_name.insert(name.to_string(), snapshot);
        }
        None => {
            by_name.remove(name);
        }
    }
    state.store(Arc::new(ProviderState {
        all_cidrs: collect_all_cidrs(&by_name),
        by_name,
    }));
}

fn collect_all_cidrs(by_name: &HashMap<String, ProviderSnapshot>) -> Vec<IpNet> {
    by_name
        .values()
        .flat_map(|snapshot| snapshot.cidrs.iter().copied())
        .collect()
}
