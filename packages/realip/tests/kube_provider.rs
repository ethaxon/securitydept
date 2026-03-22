use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    net::TcpListener,
    path::PathBuf,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use k8s_openapi::{
    api::core::v1::{Container, Namespace, Pod, PodSpec, Service, ServicePort, ServiceSpec},
    apimachinery::pkg::apis::meta::v1::ObjectMeta,
};
use kube::{Api, Client};
use securitydept_realip::{
    ProviderRegistry,
    config::{CustomProviderConfig, ProviderConfig, RefreshFailurePolicy},
};
use testcontainers::{
    GenericBuildableImage, GenericImage, ImageExt,
    core::{ExecCommand, Mount},
    runners::{AsyncBuilder, AsyncRunner},
};
use tokio::sync::Mutex;

const DOCKER_SOCKET: &str = "/var/run/docker.sock";
const HELPER_IMAGE_NAME: &str = "securitydept-realip-kube-integration-test-helper";
const HELPER_IMAGE_TAG: &str = "v1";
const KIND_NODE_IMAGE: &str = "kindest/node:v1.31.2";
const K3S_IMAGE: &str = "rancher/k3s:v1.31.4-k3s1";

static KUBECONFIG_ENV_LOCK: Mutex<()> = Mutex::const_new(());

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

struct KubeconfigEnvGuard {
    previous: Option<OsString>,
}

impl KubeconfigEnvGuard {
    fn set(path: &PathBuf) -> Self {
        let previous = std::env::var_os("KUBECONFIG");
        unsafe {
            std::env::set_var("KUBECONFIG", path);
        }
        Self { previous }
    }
}

impl Drop for KubeconfigEnvGuard {
    fn drop(&mut self) {
        unsafe {
            if let Some(value) = self.previous.take() {
                std::env::set_var("KUBECONFIG", value);
            } else {
                std::env::remove_var("KUBECONFIG");
            }
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

async fn build_helper_image() -> anyhow::Result<GenericImage> {
    GenericBuildableImage::new(HELPER_IMAGE_NAME, HELPER_IMAGE_TAG)
        .with_dockerfile_string(
            r#"FROM docker:28-cli
RUN apk add --no-cache bash curl ca-certificates
RUN ARCH="$(apk --print-arch)" \
 && case "${ARCH}" in \
        x86_64) BIN_ARCH="amd64" ;; \
        aarch64) BIN_ARCH="arm64" ;; \
        *) echo "unsupported arch: ${ARCH}" >&2; exit 1 ;; \
    esac \
 && KIND_VERSION="v0.27.0" \
 && curl -fsSL -o /usr/local/bin/kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-linux-${BIN_ARCH}" \
 && chmod +x /usr/local/bin/kind \
 && K3D_VERSION="v5.8.3" \
 && curl -fsSL -o /usr/local/bin/k3d "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-${BIN_ARCH}" \
 && chmod +x /usr/local/bin/k3d \
 && KUBECTL_VERSION="v1.31.2" \
 && curl -fsSL -o /usr/local/bin/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${BIN_ARCH}/kubectl" \
 && chmod +x /usr/local/bin/kubectl
CMD ["sleep", "infinity"]"#,
        )
        .build_image()
        .await
        .map_err(anyhow::Error::from)
}

async fn start_helper_container() -> anyhow::Result<testcontainers::ContainerAsync<GenericImage>> {
    let image = build_helper_image().await?;
    image
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

async fn kube_client() -> anyhow::Result<Client> {
    Client::try_default().await.map_err(anyhow::Error::from)
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
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn kube_provider_config(
    name: &str,
    resource: &str,
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
            .chain([("resource".to_string(), serde_json::json!(resource))])
            .collect(),
    })
}

#[tokio::test]
async fn kind_provider_loads_native_pod_ips() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();
    let _lock = KUBECONFIG_ENV_LOCK.lock().await;
    let helper = start_helper_container().await?;
    let (cluster_name, kubeconfig_path) = create_cluster(&helper, ClusterFlavor::Kind).await?;
    let _kubeconfig_env = KubeconfigEnvGuard::set(&kubeconfig_path);

    let result = async {
        let client = kube_client().await?;
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
    let _lock = KUBECONFIG_ENV_LOCK.lock().await;
    let helper = start_helper_container().await?;
    let (cluster_name, kubeconfig_path) = create_cluster(&helper, ClusterFlavor::K3d).await?;
    let _kubeconfig_env = KubeconfigEnvGuard::set(&kubeconfig_path);

    let result = async {
        let cidrs = wait_for_provider_cidrs(
            kube_provider_config(
                "k3d-traefik-pods",
                "pods",
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
