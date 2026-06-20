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
    config::{CoreNodeConfig, NodeConfig, RefreshFailurePolicy, parse_ip_or_cidr},
    error::{RealIpError, RealIpResult},
    extension::{CidrNodeFactoryRegistry, DynamicCidrNode},
};

#[derive(Debug, Clone)]
pub struct CidrNodeSnapshot {
    pub cidrs: Arc<Vec<IpNet>>,
    pub updated_at: Instant,
    pub stale_after: Option<Duration>,
}

impl CidrNodeSnapshot {
    fn new(cidrs: Vec<IpNet>, stale_after: Option<Duration>) -> Self {
        Self {
            cidrs: Arc::new(cidrs),
            updated_at: Instant::now(),
            stale_after,
        }
    }

    pub fn is_stale(&self) -> bool {
        self.stale_after
            .is_some_and(|max_age| self.updated_at.elapsed() > max_age)
    }

    pub fn contains(&self, ip: std::net::IpAddr) -> bool {
        !self.is_stale() && self.cidrs.iter().any(|cidr| cidr.contains(&ip))
    }
}

#[derive(Debug)]
pub struct CidrNodeRegistry {
    state: Arc<ArcSwap<CidrNodeState>>,
    tasks: Vec<JoinHandle<()>>,
    _watchers: Vec<RecommendedWatcher>,
}

#[derive(Debug, Default)]
struct CidrNodeState {
    by_name: HashMap<String, CidrNodeSnapshot>,
}

impl CidrNodeRegistry {
    pub async fn from_configs(configs: &[NodeConfig]) -> RealIpResult<Self> {
        let factories = CidrNodeFactoryRegistry::with_builtin_nodes()?;
        Self::from_configs_with_factories(configs, &factories).await
    }

    pub async fn from_configs_with_factories(
        configs: &[NodeConfig],
        factories: &CidrNodeFactoryRegistry,
    ) -> RealIpResult<Self> {
        let mut by_name = HashMap::new();
        let mut runtime_configs = Vec::new();
        let mut tasks = Vec::new();
        let mut watchers = Vec::new();

        for config in configs.iter().filter(|config| config.is_cidr_backed()) {
            let custom_node = build_custom_cidr_node(config, factories)?;
            let snapshot = load_cidr_node(config, custom_node.as_deref()).await?;
            by_name.insert(config.name().to_string(), snapshot);
            runtime_configs.push((config.clone(), custom_node));
        }

        let state = Arc::new(ArcSwap::from_pointee(CidrNodeState { by_name }));

        for (config, custom_node) in runtime_configs {
            if let Some(handle) =
                spawn_refresh_task(config.clone(), custom_node.clone(), state.clone())
            {
                tasks.push(handle);
            }

            if let Some((watcher, handle)) = spawn_file_watcher(config, state.clone())? {
                watchers.push(watcher);
                tasks.push(handle);
            }
        }

        Ok(Self {
            state,
            tasks,
            _watchers: watchers,
        })
    }

    pub fn snapshot(&self, name: &str) -> Option<CidrNodeSnapshot> {
        self.state
            .load()
            .by_name
            .get(name)
            .filter(|snapshot| !snapshot.is_stale())
            .cloned()
    }

    pub fn contains(&self, name: &str, ip: std::net::IpAddr) -> bool {
        self.snapshot(name)
            .is_some_and(|snapshot| snapshot.contains(ip))
    }
}

impl Drop for CidrNodeRegistry {
    fn drop(&mut self) {
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn spawn_refresh_task(
    config: NodeConfig,
    custom_node: Option<Arc<dyn DynamicCidrNode>>,
    state: Arc<ArcSwap<CidrNodeState>>,
) -> Option<JoinHandle<()>> {
    let refresh = config.refresh()?;

    Some(tokio::spawn(async move {
        loop {
            sleep(refresh).await;
            if let Err(error) = refresh_cidr_node(&config, custom_node.as_deref(), &state).await {
                warn!(node = %config.name(), error = %error, "Failed to refresh real-IP CIDR node");
            }
        }
    }))
}

fn spawn_file_watcher(
    config: NodeConfig,
    state: Arc<ArcSwap<CidrNodeState>>,
) -> RealIpResult<Option<(RecommendedWatcher, JoinHandle<()>)>> {
    let (path, debounce) = match config.watch_path() {
        Some((path, debounce)) => (path.clone(), debounce),
        None => return Ok(None),
    };
    let (tx, mut rx) = watch::channel(());

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|error| RealIpError::WatchCidrNode {
        path: path.clone(),
        details: error.to_string(),
    })?;
    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|error| RealIpError::WatchCidrNode {
            path: path.clone(),
            details: error.to_string(),
        })?;

    let handle = tokio::spawn(async move {
        while rx.changed().await.is_ok() {
            sleep(debounce).await;
            if let Err(error) = refresh_cidr_node(&config, None, &state).await {
                warn!(node = %config.name(), error = %error, "Failed to refresh watched real-IP CIDR node");
            }
        }
    });

    Ok(Some((watcher, handle)))
}

async fn refresh_cidr_node(
    config: &NodeConfig,
    custom_node: Option<&dyn DynamicCidrNode>,
    state: &Arc<ArcSwap<CidrNodeState>>,
) -> RealIpResult<()> {
    match load_cidr_node(config, custom_node).await {
        Ok(snapshot) => {
            replace_cidr_node_snapshot(state, config.name(), Some(snapshot));
            debug!(node = %config.name(), "Refreshed real-IP CIDR node");
            Ok(())
        }
        Err(error) => {
            if matches!(config.on_refresh_failure(), RefreshFailurePolicy::Clear) {
                replace_cidr_node_snapshot(state, config.name(), None);
            }
            Err(error)
        }
    }
}

async fn load_cidr_node(
    config: &NodeConfig,
    custom_node: Option<&dyn DynamicCidrNode>,
) -> RealIpResult<CidrNodeSnapshot> {
    let cidrs = match config {
        NodeConfig::Core(CoreNodeConfig::CidrsInline(config)) => config.cidrs.clone(),
        NodeConfig::Core(CoreNodeConfig::CidrsLocalFile(_)) => {
            parse_entries(config.name(), &read_local_file(config).await?)?
        }
        NodeConfig::Core(CoreNodeConfig::CidrsRemoteFile(_)) => {
            let mut cidrs = Vec::new();
            for content in read_remote_files(config).await? {
                cidrs.extend(parse_entries(config.name(), &content)?);
            }
            cidrs
        }
        NodeConfig::Core(CoreNodeConfig::CidrsCommand(_)) => {
            parse_entries(config.name(), &run_command(config).await?)?
        }
        NodeConfig::CustomCidr(config) => {
            custom_node
                .ok_or_else(|| RealIpError::MissingCidrNodeFactory {
                    kind: config.kind.clone(),
                })?
                .load()
                .await?
        }
        _ => unreachable!("only CIDR-backed node configs are loaded"),
    };

    if cidrs.is_empty() {
        return Err(RealIpError::EmptyCidrNodeOutput {
            node: config.name().to_string(),
        });
    }

    Ok(CidrNodeSnapshot::new(cidrs, config.max_stale()))
}

fn build_custom_cidr_node(
    config: &NodeConfig,
    factories: &CidrNodeFactoryRegistry,
) -> RealIpResult<Option<Arc<dyn DynamicCidrNode>>> {
    let Some(custom) = config.custom_cidr() else {
        return Ok(None);
    };
    let Some(factory) = factories.get(&custom.kind) else {
        return Err(RealIpError::MissingCidrNodeFactory {
            kind: custom.kind.clone(),
        });
    };
    factory.create(custom).map(Some)
}

async fn read_local_file(config: &NodeConfig) -> RealIpResult<String> {
    let path = config.local_file_path().expect("validated path").clone();
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|source| RealIpError::ReadCidrNodeFile { path, source })
}

async fn read_remote_files(config: &NodeConfig) -> RealIpResult<Vec<String>> {
    let urls = config.remote_file_urls().expect("validated URLs");
    let mut builder = reqwest::Client::builder();
    if let Some(timeout) = config.timeout() {
        builder = builder.timeout(timeout);
    }
    let client = builder
        .build()
        .map_err(|source| RealIpError::CidrNodeHttp {
            url: urls.join(","),
            source,
        })?;

    let mut contents = Vec::with_capacity(urls.len());
    for url in urls {
        let response = client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|source| RealIpError::CidrNodeHttp {
                url: url.clone(),
                source,
            })?;
        contents.push(
            response
                .text()
                .await
                .map_err(|source| RealIpError::CidrNodeHttp {
                    url: url.clone(),
                    source,
                })?,
        );
    }
    Ok(contents)
}

async fn run_command(config: &NodeConfig) -> RealIpResult<String> {
    let (command, args) = config.command_spec().expect("validated command");
    let command = command.to_string();
    let mut child = Command::new(&command);
    child.args(args);
    child.stdout(Stdio::piped());
    child.stderr(Stdio::piped());

    let output = if let Some(limit) = config.timeout() {
        timeout(limit, child.output())
            .await
            .map_err(|_| RealIpError::CidrNodeCommand {
                command: command.clone(),
                details: format!("timed out after {limit:?}"),
            })?
            .map_err(|error| RealIpError::CidrNodeCommand {
                command: command.clone(),
                details: error.to_string(),
            })?
    } else {
        child
            .output()
            .await
            .map_err(|error| RealIpError::CidrNodeCommand {
                command: command.clone(),
                details: error.to_string(),
            })?
    };

    if !output.status.success() {
        return Err(RealIpError::CidrNodeCommand {
            command,
            details: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn parse_entries(node: &str, content: &str) -> RealIpResult<Vec<IpNet>> {
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
            let cidr = parse_ip_or_cidr(entry).map_err(|_| RealIpError::InvalidCidrNodeEntry {
                node: node.to_string(),
                entry: entry.to_string(),
            })?;
            cidrs.push(cidr);
        }
    }
    Ok(cidrs)
}

fn replace_cidr_node_snapshot(
    state: &Arc<ArcSwap<CidrNodeState>>,
    name: &str,
    snapshot: Option<CidrNodeSnapshot>,
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
    state.store(Arc::new(CidrNodeState { by_name }));
}
