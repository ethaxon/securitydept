# Real IP 策略

`securitydept-realip` 负责多层信任网络边界（如 `Client -> CDN -> L4 LB -> Proxy -> app`）的真实 IP 解析。

核心安全基线：**除非直连对端是已验证的信任节点，否则绝不单独信任任何 client-IP 头。**

## 核心模型
- **Providers (提供方)**: 提供受信任的 CIDR 集合（如静态配置、远程列表、Docker/Kube API 动态集）。
- **Sources (信任源)**: 匹配对端 CIDR 后，决定允许解析哪些传输层协议或 HTTP 头。

### 解析管线
1. 检查直连 Socket Peer IP。
2. 匹配配置中的 trusted `sources`。
3. 若命中，按照强弱优先级解析允许的输入（PROXY protocol -> `CF-Connecting-IP` 单值头 -> 递归剥离 `X-Forwarded-For`/`Forwarded`）。
4. 若未命中任何 source，降级使用直连 peer IP。

## 配置结构
分为 `providers``sources` 和 `fallback` 三部分。

### 1. Providers
定义信任边界。内建类型：
- `inline`: 静态 CIDR 数组。
- `local-file`: 本地 CIDR 列表文件（支持 `watch`）。
- `remote-file`: 可定时 `refresh` 的远程 URL。
- `command`: 执行脚本自动发现 CIDR。
- `docker-provider`: 通过 Docker API 提取受信任内部代理网络。
- `kube-provider`: 通过 K8s API 获取 Ingress 等受信任网关组件的 Pod/Endpoints IP。

*提示：不要盲目信任全集群或 `10.0.0.0/8` 私网，务必将信任范围限制到特定的入口网关。*

### 2. Sources
定义信任解析契约：
- `peers_from`: 引用 providers。
- `accept_headers`: 头解析策略（如 `single` 提取或 `recursive` 链式剥离）。
- `accept_transport`: 如 `proxy-protocol`。

### 3. Fallback
未命中时的回退兜底，通常明确指定为 `remote-addr`。

## API 形状
向业务或中间件暴露确定性的解析结果：
```rust
pub struct ResolvedClientIp {
    pub client_ip: std::net::IpAddr,
    pub peer_ip: std::net::IpAddr,
    pub source_name: Option<String>,
    pub source_kind: ResolvedSourceKind,
    pub header_name: Option<String>,
}
```

## 测试策略
为兼顾准确与稳定性，crate 采用三层递进的测试体系：
1. **单元测试 (`src/*`)**: 验证 IP 解析与重构逻辑、CIDR 匹配及策略覆盖率。
2. **Core 集成测试 (`tests/core_providers.rs`)**: 启动模拟端口或写入随机临时文件，独立测试 `inline`/`local-file`/`remote-file`/`command` 在防抖/轮询/异步容错上的健壮性。
3. **环境特定行为测试 (`tests/docker_provider.rs``tests/kube_provider.rs`)**:
   - 依赖 `testcontainers` 动态启动底层基础环境。
   - 对 `kube-provider` 这类复杂发现会建立 Kind 或 K3d 轻量集群，创建原生 Pod/Service 及 Traefik 组件，再用内部集成 client 直接查询端点进行闭环对比验证；对 docker 亦同。
   - 开发与独立验证：可以用 `cargo test -p securitydept-realip --test [测试文件名]` 单独运行。

---

[English](../en/006-REALIP.md) | [中文](006-REALIP.md)
