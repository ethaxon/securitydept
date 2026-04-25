use std::{
    collections::BTreeMap,
    fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use k8s_openapi::{
    api::core::v1::{Container, Namespace, Pod, PodSpec, Service, ServicePort, ServiceSpec},
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
const KIND_NODE_IMAGE: &str = "kindest/node:v1.31.2";
const K3S_IMAGE: &str = "rancher/k3s:v1.31.4-k3s1";

#[derive(Clone, Copy)]
enum ClusterFlavor {
    Kind,
    K3d,
}

impl ClusterFlavor {
    fn prefix(self) -> &'static str {
        match self {
            Self::Kind => "kind",
            Self::K3d => "k3d",
        }
    }
}

fn unique_name(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("sd-{prefix}-{millis}")
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

fn ensure_helper_image_ready() -> anyhow::Result<()> {
    let server_os = docker_stdout(&["version", "--format", "{{.Server.Os}}"])?;
    if server_os.trim() != "linux" {
        anyhow::bail!(
            "kube integration tests require Docker running Linux containers; detected server os '{}'.",
            server_os.trim()
        );
    }

    let image_ref = helper_image_ref();
    if let Err(error) = docker_stdout(&["image", "inspect", &image_ref]) {
        anyhow::bail!(
            "required helper image '{}' is missing. Build it first with `just build-kube-test-helper`. {}",
            image_ref,
            error
        );
    }

    Ok(())
}

async fn exec_stdout(
    container: &testcontainers::ContainerAsync<GenericImage>,
    command: impl IntoIterator<Item = impl Into<String>>,
) -> anyhow::Result<String> {
    let mut result = container.exec(ExecCommand::new(command)).await?;
    let stdout = String::from_utf8(result.stdout_to_vec().await?)?;
    // If testcontainers has exit_code, we should check it, but testcontainers 0.27
    // might not have it exposed directly in ExecResult. Instead let's just also
    // fetch stderr
    let stderr = String::from_utf8(result.stderr_to_vec().await?)?;
    if !stderr.is_empty() {
        println!("STDERR: {}", stderr);
    }
    Ok(stdout)
}

async fn start_helper_container() -> anyhow::Result<testcontainers::ContainerAsync<GenericImage>> {
    ensure_helper_image_ready()?;
    GenericImage::new(HELPER_IMAGE_NAME, HELPER_IMAGE_TAG)
        .with_mount(Mount::bind_mount(DOCKER_SOCKET, DOCKER_SOCKET))
        .start()
        .await
        .map_err(anyhow::Error::from)
}

async fn create_cluster(
    helper: &testcontainers::ContainerAsync<GenericImage>,
    flavor: ClusterFlavor,
) -> anyhow::Result<(String, PathBuf)> {
    let cluster_name = unique_name(flavor.prefix());
    let api_port = reserve_local_port();

    let kubeconfig = match flavor {
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
            .await?
        }
        ClusterFlavor::K3d => {
            exec_stdout(
                helper,
                [
                    "sh",
                    "-lc",
                    &format!(
                        "k3d cluster create {cluster_name} --wait --servers 1 --agents 0 --image \
                         {K3S_IMAGE} --api-port 127.0.0.1:{api_port} >/dev/stderr && k3d \
                         kubeconfig get {cluster_name}"
                    ),
                ],
            )
            .await?
        }
    }
    .replace("https://0.0.0.0:", "https://127.0.0.1:");

    let path = std::env::temp_dir().join(format!("{cluster_name}-kubeconfig"));
    println!("DUMPING KUBECONFIG:\n{}\nEND DUMP", kubeconfig);
    fs::write(&path, kubeconfig)?;
    Ok((cluster_name, path))
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

async fn kube_client(kubeconfig_path: &Path) -> anyhow::Result<Client> {
    let kubeconfig = Kubeconfig::read_from(kubeconfig_path)?;
    let config = Config::from_custom_kubeconfig(kubeconfig, &KubeConfigOptions::default()).await?;
    Client::try_from(config).map_err(anyhow::Error::from)
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
    let (cluster_name, kubeconfig_path) = create_cluster(&helper, ClusterFlavor::Kind).await?;

    let result = async {
        let client = kube_client(&kubeconfig_path).await?;
        let namespace_name = unique_name("kind-native");
        Api::<Namespace>::all(client.clone())
            .create(
                &Default::default(),
                &Namespace {
                    metadata: ObjectMeta {
                        name: Some(namespace_name.clone()),
                        ..Default::default()
                    },
                    ..Default::default()
                },
            )
            .await?;

        Api::<Pod>::namespaced(client.clone(), &namespace_name)
            .create(
                &Default::default(),
                &Pod {
                    metadata: ObjectMeta {
                        name: Some("realip-native-pod".to_string()),
                        labels: Some(BTreeMap::from([(
                            "app".to_string(),
                            "realip-native".to_string(),
                        )])),
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
                &kubeconfig_path,
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
                &kubeconfig_path,
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
                &kubeconfig_path,
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

    delete_cluster(&helper, ClusterFlavor::Kind, &cluster_name).await;
    let _ = fs::remove_file(kubeconfig_path);
    result
}

#[tokio::test]
async fn k3d_provider_loads_k3s_default_traefik_pods() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let helper = start_helper_container().await?;
    let (cluster_name, kubeconfig_path) = create_cluster(&helper, ClusterFlavor::K3d).await?;

    let result = async {
        let cidrs = wait_for_provider_cidrs(
            kube_provider_config(
                "k3d-traefik-pods",
                "pods",
                &kubeconfig_path,
                BTreeMap::from([
                    ("namespace".to_string(), serde_json::json!("kube-system")),
                    (
                        "label_selector".to_string(),
                        serde_json::json!("app.kubernetes.io/name=traefik"),
                    ),
                ]),
            ),
            Duration::from_secs(180),
        )
        .await?;

        assert!(!cidrs.is_empty());
        assert!(
            cidrs
                .iter()
                .all(|cidr| cidr.ends_with("/32") || cidr.ends_with("/128"))
        );
        Ok::<_, anyhow::Error>(())
    }
    .await;

    delete_cluster(&helper, ClusterFlavor::K3d, &cluster_name).await;
    let _ = fs::remove_file(kubeconfig_path);
    result
}
