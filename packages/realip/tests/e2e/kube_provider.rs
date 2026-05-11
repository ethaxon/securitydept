use std::{
    collections::BTreeMap,
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use k8s_openapi::{
    api::core::v1::{
        Container, Namespace, Node, Pod, PodSpec, Service, ServiceAccount, ServicePort, ServiceSpec,
    },
    apimachinery::pkg::apis::meta::v1::ObjectMeta,
};
use kube::{
    Api, Client, Config,
    config::{KubeConfigOptions, Kubeconfig},
};
use securitydept_realip::{
    ProviderRegistry,
    config::{CustomProviderConfig, ProviderConfig, RefreshFailurePolicy},
};
use testcontainers::{
    GenericImage, ImageExt,
    core::{ExecCommand, Mount},
    runners::AsyncRunner,
};

const DOCKER_SOCKET: &str = "/var/run/docker.sock";
const HELPER_IMAGE_NAME: &str = "securitydept-realip-kube-integration-test-helper";
const HELPER_IMAGE_TAG: &str = "v1";
const KIND_NODE_IMAGE: &str = "securitydept-test/kindest-node:v1.31.2";
const K3S_IMAGE: &str = "securitydept-test/rancher-k3s:v1.31.4-k3s1";
const K3D_PAUSE_IMAGE: &str = "rancher/mirrored-pause:3.6";
const TEST_LABEL_KEY: &str = "securitydept.test";
const TEST_LABEL_VALUE: &str = "true";
const TEST_RESOURCE_LABEL_KEY: &str = "securitydept.test.resource";
const TEST_HELPER_RESOURCE_LABEL_VALUE: &str = "realip-kube-helper";
const TEST_KUBE_RESOURCE_LABEL_VALUE: &str = "realip-kube-e2e";
const TEST_KIND_CLUSTER_PREFIX: &str = "securitydept-test-kind-";
const TEST_K3D_CLUSTER_PREFIX: &str = "securitydept-test-k3d-";
const KEEP_CLUSTERS_RUNNING_ENV: &str = "SECURITYDEPT_REALIP_E2E_KEEP_CLUSTERS_RUNNING";
const REUSE_CLUSTERS_ENV: &str = "SECURITYDEPT_REALIP_E2E_REUSE_CLUSTERS";
const REUSABLE_KIND_CLUSTER_NAME: &str = "securitydept-test-kind-reuse";
const REUSABLE_K3D_CLUSTER_NAME: &str = "securitydept-test-k3d-reuse";

static KUBE_TEST_IMAGE_PREPARE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy)]
enum ClusterFlavor {
    Kind,
    K3d,
}

impl ClusterFlavor {
    fn prefix(self) -> &'static str {
        match self {
            Self::Kind => TEST_KIND_CLUSTER_PREFIX,
            Self::K3d => TEST_K3D_CLUSTER_PREFIX,
        }
    }

    fn reusable_name(self) -> &'static str {
        match self {
            Self::Kind => REUSABLE_KIND_CLUSTER_NAME,
            Self::K3d => REUSABLE_K3D_CLUSTER_NAME,
        }
    }
}

fn unique_name(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{prefix}{millis}")
}

fn reserve_local_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

fn helper_image_ref() -> String {
    format!("{HELPER_IMAGE_NAME}:{HELPER_IMAGE_TAG}")
}

fn should_reuse_clusters() -> bool {
    std::env::var(REUSE_CLUSTERS_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn should_keep_clusters_running() -> bool {
    std::env::var(KEEP_CLUSTERS_RUNNING_ENV)
        .map(|value| matches!(value.as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false)
}

fn test_kube_labels() -> BTreeMap<String, String> {
    BTreeMap::from([
        (TEST_LABEL_KEY.to_string(), TEST_LABEL_VALUE.to_string()),
        (
            TEST_RESOURCE_LABEL_KEY.to_string(),
            TEST_KUBE_RESOURCE_LABEL_VALUE.to_string(),
        ),
    ])
}

fn docker_stdout(args: &[&str]) -> anyhow::Result<String> {
    let output = Command::new("docker").args(args).output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "docker {} failed with status {}: {}",
            args.join(" "),
            output.status,
            stderr.trim()
        );
    }

    String::from_utf8(output.stdout).map_err(anyhow::Error::from)
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("realip crate should be under packages/realip")
        .to_path_buf()
}

fn image_exists(image_ref: &str) -> bool {
    docker_stdout(&["image", "inspect", image_ref]).is_ok()
}

fn ensure_kube_test_images_built() -> anyhow::Result<()> {
    let repo_root = repository_root();
    let status = Command::new("node")
        .args(["scripts/test-cli.ts", "kube", "ensure-helper"])
        .current_dir(&repo_root)
        .status()?;
    if !status.success() {
        anyhow::bail!(
            "kube test image preparation failed with status {}. Run `node scripts/test-cli.ts \
             kube ensure-helper` from '{}' for details.",
            status,
            repo_root.display()
        );
    }
    Ok(())
}

fn ensure_helper_image_ready() -> anyhow::Result<()> {
    let server_os = docker_stdout(&["version", "--format", "{{.Server.Os}}"])?;
    if server_os.trim() != "linux" {
        anyhow::bail!(
            "kube integration tests require Docker running Linux containers; detected server os \
             '{}'.",
            server_os.trim()
        );
    }

    let image_ref = helper_image_ref();
    if !image_exists(&image_ref) || !image_exists(KIND_NODE_IMAGE) || !image_exists(K3S_IMAGE) {
        let _guard = KUBE_TEST_IMAGE_PREPARE_LOCK
            .lock()
            .expect("kube test image preparation lock should not be poisoned");
        if !image_exists(&image_ref) || !image_exists(KIND_NODE_IMAGE) || !image_exists(K3S_IMAGE) {
            ensure_kube_test_images_built()?;
        }
    }

    for image_ref in [image_ref.as_str(), KIND_NODE_IMAGE, K3S_IMAGE] {
        if !image_exists(image_ref) {
            anyhow::bail!(
                "required kube test image '{}' is missing after automatic preparation. Run `node \
                 scripts/test-cli.ts kube ensure-helper` from the repository root for details.",
                image_ref
            );
        }
    }

    Ok(())
}

async fn exec_stdout(
    container: &testcontainers::ContainerAsync<GenericImage>,
    command: impl IntoIterator<Item = impl Into<String>>,
) -> anyhow::Result<String> {
    let mut result = container.exec(ExecCommand::new(command)).await?;
    let stdout = String::from_utf8(result.stdout_to_vec().await?)?;
    let stderr = String::from_utf8(result.stderr_to_vec().await?)?;
    if !stderr.is_empty() {
        println!("STDERR: {}", stderr);
    }
    let exit_code = result.exit_code().await?;
    if exit_code != Some(0) {
        anyhow::bail!(
            "helper command exited with code {:?}: {}",
            exit_code,
            stderr.trim()
        );
    }
    Ok(stdout)
}

async fn start_helper_container() -> anyhow::Result<testcontainers::ContainerAsync<GenericImage>> {
    ensure_helper_image_ready()?;
    GenericImage::new(HELPER_IMAGE_NAME, HELPER_IMAGE_TAG)
        .with_label(TEST_LABEL_KEY, TEST_LABEL_VALUE)
        .with_label(TEST_RESOURCE_LABEL_KEY, TEST_HELPER_RESOURCE_LABEL_VALUE)
        .with_mount(Mount::bind_mount(DOCKER_SOCKET, DOCKER_SOCKET))
        .start()
        .await
        .map_err(anyhow::Error::from)
}

struct KubeClusterGuard<'a> {
    helper: &'a testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
    cluster_name: String,
    keep_running: bool,
    kubeconfig_path: PathBuf,
    reusable: bool,
    cleaned: bool,
}

impl<'a> KubeClusterGuard<'a> {
    fn kubeconfig_path(&self) -> &Path {
        &self.kubeconfig_path
    }

    async fn cleanup(&mut self) {
        if self.cleaned {
            return;
        }

        if self.reusable {
            if !self.keep_running {
                stop_cluster(self.helper, self.flavor, &self.cluster_name).await;
            }
        } else {
            delete_cluster(self.helper, self.flavor, &self.cluster_name).await;
            cleanup_cluster_with_docker_cli(self.flavor, &self.cluster_name);
        }
        let _ = fs::remove_file(&self.kubeconfig_path);
        self.cleaned = true;
    }
}

impl Drop for KubeClusterGuard<'_> {
    fn drop(&mut self) {
        if self.cleaned {
            return;
        }

        if self.reusable {
            if !self.keep_running && is_securitydept_test_cluster_name(&self.cluster_name) {
                stop_cluster_with_docker_cli(self.flavor, &self.cluster_name);
            }
        } else if is_securitydept_test_cluster_name(&self.cluster_name) {
            cleanup_cluster_with_docker_cli(self.flavor, &self.cluster_name);
        }
        let _ = fs::remove_file(&self.kubeconfig_path);
    }
}

async fn create_named_cluster(
    helper: &testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
    cluster_name: &str,
) -> anyhow::Result<String> {
    let api_port = reserve_local_port();

    let result = match flavor {
        ClusterFlavor::Kind => {
            let config = format!(
                "kind: Cluster\napiVersion: kind.x-k8s.io/v1alpha4\nnetworking:\n  \
                 apiServerAddress: 127.0.0.1\n  apiServerPort: {api_port}\nnodes:\n- role: \
                 control-plane\n  image: {KIND_NODE_IMAGE}\n"
            );
            exec_stdout(
                helper,
                [
                    "sh",
                    "-lc",
                    &format!(
                        "cat <<'EOF' >/tmp/kind-config.yaml\n{config}EOF\nkind create cluster \
                         --name {cluster_name} --config /tmp/kind-config.yaml --wait 180s \
                         >/dev/stderr && kind get kubeconfig --name {cluster_name}"
                    ),
                ],
            )
            .await
        }
        ClusterFlavor::K3d => {
            exec_stdout(
                helper,
                [
                    "sh",
                    "-lc",
                    &format!(
                        "k3d cluster create {cluster_name} --wait --servers 1 --agents 0 --image \
                         {K3S_IMAGE} --api-port 127.0.0.1:{api_port} --runtime-label \
                         {TEST_LABEL_KEY}={TEST_LABEL_VALUE}@server:* --runtime-label \
                         {TEST_LABEL_KEY}={TEST_LABEL_VALUE}@loadbalancer:* --runtime-label \
                         {TEST_RESOURCE_LABEL_KEY}={TEST_KUBE_RESOURCE_LABEL_VALUE}@server:* \
                         --runtime-label \
                         {TEST_RESOURCE_LABEL_KEY}={TEST_KUBE_RESOURCE_LABEL_VALUE}@loadbalancer:* \
                         >/dev/stderr && k3d kubeconfig get {cluster_name}"
                    ),
                ],
            )
            .await
        }
    };
    let kubeconfig = match result {
        Ok(kubeconfig) => kubeconfig.replace("https://0.0.0.0:", "https://127.0.0.1:"),
        Err(error) => {
            delete_cluster(helper, flavor, cluster_name).await;
            cleanup_cluster_with_docker_cli(flavor, cluster_name);
            return Err(error);
        }
    };

    Ok(kubeconfig)
}

async fn get_cluster_kubeconfig(
    helper: &testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
    cluster_name: &str,
) -> anyhow::Result<String> {
    let kubeconfig = match flavor {
        ClusterFlavor::Kind => {
            exec_stdout(
                helper,
                ["kind", "get", "kubeconfig", "--name", cluster_name],
            )
            .await?
        }
        ClusterFlavor::K3d => {
            exec_stdout(helper, ["k3d", "kubeconfig", "get", cluster_name]).await?
        }
    };
    Ok(kubeconfig.replace("https://0.0.0.0:", "https://127.0.0.1:"))
}

async fn start_existing_cluster(
    helper: &testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
    cluster_name: &str,
) -> anyhow::Result<()> {
    match flavor {
        ClusterFlavor::Kind => {
            exec_stdout(
                helper,
                ["docker", "start", &format!("{cluster_name}-control-plane")],
            )
            .await?;
        }
        ClusterFlavor::K3d => {
            exec_stdout(helper, ["k3d", "cluster", "start", cluster_name]).await?;
        }
    }
    Ok(())
}

async fn stop_cluster(
    helper: &testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
    cluster_name: &str,
) {
    let _ = match flavor {
        ClusterFlavor::Kind => {
            exec_stdout(
                helper,
                ["docker", "stop", &format!("{cluster_name}-control-plane")],
            )
            .await
        }
        ClusterFlavor::K3d => exec_stdout(helper, ["k3d", "cluster", "stop", cluster_name]).await,
    };
}

fn write_kubeconfig(cluster_name: &str, kubeconfig: &str) -> anyhow::Result<PathBuf> {
    let path = std::env::temp_dir().join(format!("{cluster_name}-kubeconfig"));
    println!("DUMPING KUBECONFIG:\n{}\nEND DUMP", kubeconfig);
    fs::write(&path, kubeconfig)?;
    Ok(path)
}

async fn create_cluster_guard<'a>(
    helper: &'a testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
) -> anyhow::Result<KubeClusterGuard<'a>> {
    let keep_running = should_keep_clusters_running();
    let reusable = should_reuse_clusters();
    let cluster_name = if reusable {
        flavor.reusable_name().to_string()
    } else {
        unique_name(flavor.prefix())
    };
    let kubeconfig = if reusable {
        match start_existing_cluster(helper, flavor, &cluster_name).await {
            Ok(()) => get_cluster_kubeconfig(helper, flavor, &cluster_name).await?,
            Err(_) => create_named_cluster(helper, flavor, &cluster_name).await?,
        }
    } else {
        create_named_cluster(helper, flavor, &cluster_name).await?
    };
    let kubeconfig_path = write_kubeconfig(&cluster_name, &kubeconfig)?;
    wait_for_kube_api(&kubeconfig_path).await?;
    Ok(KubeClusterGuard {
        helper,
        flavor,
        cluster_name,
        keep_running,
        kubeconfig_path,
        reusable,
        cleaned: false,
    })
}

async fn delete_cluster(
    helper: &testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
    cluster_name: &str,
) {
    let _ = match flavor {
        ClusterFlavor::Kind => {
            exec_stdout(
                helper,
                ["kind", "delete", "cluster", "--name", cluster_name],
            )
            .await
        }
        ClusterFlavor::K3d => exec_stdout(helper, ["k3d", "cluster", "delete", cluster_name]).await,
    };
}

fn is_securitydept_test_cluster_name(cluster_name: &str) -> bool {
    cluster_name.starts_with(TEST_KIND_CLUSTER_PREFIX)
        || cluster_name.starts_with(TEST_K3D_CLUSTER_PREFIX)
}

fn docker_stdout_allow_failure(args: &[&str]) -> Option<String> {
    Command::new("docker")
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
}

fn docker_remove_containers_by_label(label: &str) {
    let Some(stdout) = docker_stdout_allow_failure(&["ps", "-aq", "--filter", label]) else {
        return;
    };
    let ids = stdout
        .split_whitespace()
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return;
    }

    let mut args = vec!["rm", "-f"];
    args.extend(ids);
    let _ = Command::new("docker").args(args).output();
}

fn docker_remove_named_resource(kind: &str, name: &str) {
    let _ = Command::new("docker").args([kind, "rm", name]).output();
}

fn docker_stop_containers_by_label(label: &str) {
    let Some(stdout) = docker_stdout_allow_failure(&["ps", "-q", "--filter", label]) else {
        return;
    };
    let ids = stdout
        .split_whitespace()
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return;
    }

    let mut args = vec!["stop"];
    args.extend(ids);
    let _ = Command::new("docker").args(args).output();
}

fn docker_stop_named_container(name: &str) {
    let _ = Command::new("docker").args(["stop", name]).output();
}

fn stop_cluster_with_docker_cli(flavor: ClusterFlavor, cluster_name: &str) {
    if !is_securitydept_test_cluster_name(cluster_name) {
        return;
    }

    match flavor {
        ClusterFlavor::Kind => {
            docker_stop_named_container(&format!("{cluster_name}-control-plane"))
        }
        ClusterFlavor::K3d => {
            docker_stop_containers_by_label(&format!("label=k3d.cluster={cluster_name}"));
        }
    }
}

fn cleanup_cluster_with_docker_cli(flavor: ClusterFlavor, cluster_name: &str) {
    if !is_securitydept_test_cluster_name(cluster_name) {
        return;
    }

    match flavor {
        ClusterFlavor::Kind => {
            docker_remove_containers_by_label(&format!(
                "label=io.x-k8s.kind.cluster={cluster_name}"
            ));
        }
        ClusterFlavor::K3d => {
            docker_remove_containers_by_label(&format!("label=k3d.cluster={cluster_name}"));
            docker_remove_named_resource("network", &format!("k3d-{cluster_name}"));
            docker_remove_named_resource("volume", &format!("k3d-{cluster_name}-images"));
        }
    }
}

async fn diagnose_k3d_cluster(
    helper: &testcontainers::ContainerAsync<GenericImage>,
    cluster_name: &str,
) -> anyhow::Result<String> {
    let server_name = format!("k3d-{cluster_name}-server-0");
    exec_stdout(
        helper,
        [
            "sh",
            "-lc",
            &format!(
                "docker exec {server_name} kubectl get pods -A -o wide && echo --- && docker exec \
                 {server_name} kubectl get events -A --sort-by=.lastTimestamp | tail -n 120"
            ),
        ],
    )
    .await
}

fn is_known_k3d_environment_issue(diagnostics: &str) -> bool {
    diagnostics.contains(K3D_PAUSE_IMAGE)
        && (diagnostics.contains("FailedCreatePodSandBox")
            || diagnostics.contains("failed to pull image")
            || diagnostics.contains("i/o timeout"))
}

async fn kube_client(kubeconfig_path: &Path) -> anyhow::Result<Client> {
    let kubeconfig = Kubeconfig::read_from(kubeconfig_path)?;
    let config = Config::from_custom_kubeconfig(kubeconfig, &KubeConfigOptions::default()).await?;
    Client::try_from(config).map_err(anyhow::Error::from)
}

async fn wait_for_kube_api(kubeconfig_path: &Path) -> anyhow::Result<()> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(120);
    loop {
        if let Ok(client) = kube_client(kubeconfig_path).await {
            let nodes = Api::<Node>::all(client);
            if nodes.list(&Default::default()).await.is_ok() {
                return Ok(());
            }
        }

        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for kube API to become reachable");
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

async fn wait_for_default_service_account(client: &Client, namespace: &str) -> anyhow::Result<()> {
    let service_accounts = Api::<ServiceAccount>::namespaced(client.clone(), namespace);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if service_accounts.get("default").await.is_ok() {
            return Ok(());
        }

        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for default service account in namespace {namespace}");
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn wait_for_provider_cidrs(
    config: ProviderConfig,
    timeout: Duration,
) -> anyhow::Result<Vec<String>> {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if let Ok(registry) = ProviderRegistry::from_configs(std::slice::from_ref(&config)).await {
            let cidrs = registry
                .all_cidrs()
                .await
                .into_iter()
                .map(|cidr| cidr.to_string())
                .collect::<Vec<_>>();
            if !cidrs.is_empty() {
                return Ok(cidrs);
            }
        }

        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("timed out waiting for kube provider to return CIDRs");
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

fn kube_provider_config(
    name: &str,
    resource: &str,
    kubeconfig_path: &Path,
    extra: BTreeMap<String, serde_json::Value>,
) -> ProviderConfig {
    ProviderConfig::Custom(CustomProviderConfig {
        name: name.to_string(),
        kind: "kube-provider".to_string(),
        refresh: None,
        timeout: None,
        on_refresh_failure: RefreshFailurePolicy::KeepLastGood,
        max_stale: None,
        extra: extra
            .into_iter()
            .chain([(
                "kubeconfig_path".to_string(),
                serde_json::json!(kubeconfig_path.to_string_lossy().to_string()),
            )])
            .chain([("resource".to_string(), serde_json::json!(resource))])
            .collect(),
    })
}

#[tokio::test]
async fn kind_provider_loads_native_pod_ips() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let helper = start_helper_container().await?;
    let mut cluster = create_cluster_guard(&helper, ClusterFlavor::Kind).await?;

    let result = async {
        let client = kube_client(cluster.kubeconfig_path()).await?;
        let namespace_name = unique_name("kind-native");
        Api::<Namespace>::all(client.clone())
            .create(
                &Default::default(),
                &Namespace {
                    metadata: ObjectMeta {
                        name: Some(namespace_name.clone()),
                        labels: Some(test_kube_labels()),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            )
            .await?;
        wait_for_default_service_account(&client, &namespace_name).await?;

        Api::<Pod>::namespaced(client.clone(), &namespace_name)
            .create(
                &Default::default(),
                &Pod {
                    metadata: ObjectMeta {
                        name: Some("realip-native-pod".to_string()),
                        labels: Some(
                            test_kube_labels()
                                .into_iter()
                                .chain([("app".to_string(), "realip-native".to_string())])
                                .collect(),
                        ),
                        ..Default::default()
                    },
                    spec: Some(PodSpec {
                        containers: vec![Container {
                            name: "pause".to_string(),
                            image: Some("registry.k8s.io/pause:3.10".to_string()),
                            ..Default::default()
                        }],
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .await?;

        Api::<Service>::namespaced(client.clone(), &namespace_name)
            .create(
                &Default::default(),
                &Service {
                    metadata: ObjectMeta {
                        name: Some("realip-native-svc".to_string()),
                        labels: Some(test_kube_labels()),
                        ..Default::default()
                    },
                    spec: Some(ServiceSpec {
                        selector: Some(BTreeMap::from([(
                            "app".to_string(),
                            "realip-native".to_string(),
                        )])),
                        ports: Some(vec![ServicePort {
                            port: 80,
                            ..Default::default()
                        }]),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            )
            .await?;

        let cidrs = wait_for_provider_cidrs(
            kube_provider_config(
                "kind-native-pods",
                "pods",
                cluster.kubeconfig_path(),
                BTreeMap::from([
                    ("namespace".to_string(), serde_json::json!(namespace_name)),
                    (
                        "label_selector".to_string(),
                        serde_json::json!("app=realip-native"),
                    ),
                ]),
            ),
            Duration::from_secs(120),
        )
        .await?;

        assert_eq!(cidrs.len(), 1);
        assert!(cidrs[0].ends_with("/32") || cidrs[0].ends_with("/128"));

        let ep_cidrs = wait_for_provider_cidrs(
            kube_provider_config(
                "kind-native-endpoints",
                "endpoints",
                cluster.kubeconfig_path(),
                BTreeMap::from([
                    ("namespace".to_string(), serde_json::json!(namespace_name)),
                    ("name".to_string(), serde_json::json!("realip-native-svc")),
                ]),
            ),
            Duration::from_secs(120),
        )
        .await?;
        assert_eq!(ep_cidrs.len(), 1);

        let eps_cidrs = wait_for_provider_cidrs(
            kube_provider_config(
                "kind-native-endpoint-slices",
                "endpoint-slices",
                cluster.kubeconfig_path(),
                BTreeMap::from([
                    ("namespace".to_string(), serde_json::json!(namespace_name)),
                    (
                        "label_selector".to_string(),
                        serde_json::json!("kubernetes.io/service-name=realip-native-svc"),
                    ),
                ]),
            ),
            Duration::from_secs(120),
        )
        .await?;
        assert_eq!(eps_cidrs.len(), 1);

        Ok::<_, anyhow::Error>(())
    }
    .await;

    cluster.cleanup().await;
    result
}

#[tokio::test]
async fn k3d_provider_loads_k3s_default_traefik_pods() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let helper = start_helper_container().await?;
    let mut cluster = create_cluster_guard(&helper, ClusterFlavor::K3d).await?;

    let result = async {
        let config = kube_provider_config(
            "k3d-traefik-pods",
            "pods",
            cluster.kubeconfig_path(),
            BTreeMap::from([
                ("namespace".to_string(), serde_json::json!("kube-system")),
                (
                    "label_selector".to_string(),
                    serde_json::json!("app.kubernetes.io/name=traefik"),
                ),
            ]),
        );
        let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
        let cidrs = loop {
            let now = tokio::time::Instant::now();
            let remaining = deadline.saturating_duration_since(now);
            let attempt_timeout = remaining.min(Duration::from_secs(15));
            match wait_for_provider_cidrs(config.clone(), attempt_timeout).await {
                Ok(cidrs) => break cidrs,
                Err(_error) if remaining > Duration::from_secs(15) => {
                    let diagnostics = diagnose_k3d_cluster(&helper, &cluster.cluster_name).await?;
                    if is_known_k3d_environment_issue(&diagnostics) {
                        eprintln!(
                            "skipping k3d_provider_loads_k3s_default_traefik_pods: k3d cluster \
                             did not become schedulable in this environment; system pods could \
                             not pull {K3D_PAUSE_IMAGE}.\n{diagnostics}"
                        );
                        return Ok(());
                    }
                    continue;
                }
                Err(error) => {
                    let diagnostics = diagnose_k3d_cluster(&helper, &cluster.cluster_name).await?;
                    if is_known_k3d_environment_issue(&diagnostics) {
                        eprintln!(
                            "skipping k3d_provider_loads_k3s_default_traefik_pods: k3d cluster \
                             did not become schedulable in this environment; system pods could \
                             not pull {K3D_PAUSE_IMAGE}.\n{diagnostics}"
                        );
                        return Ok(());
                    }

                    return Err(error.context(format!(
                        "k3d provider did not return CIDRs; cluster diagnostics:\n{diagnostics}"
                    )));
                }
            }
        };

        assert!(!cidrs.is_empty());
        assert!(
            cidrs
                .iter()
                .all(|cidr| cidr.ends_with("/32") || cidr.ends_with("/128"))
        );
        Ok::<_, anyhow::Error>(())
    }
    .await;

    cluster.cleanup().await;
    result
}
