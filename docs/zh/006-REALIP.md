# Real-IP 策略

`securitydept-realip` 用于跨混合代理边界解析有效客户端 IP，例如：

```text
client -> CDN -> reverse proxy -> container network -> application
```

Resolver 不会把所有已配置 CIDR 合并为一个全局可信集合。它会针对每个相邻 hop 验证明确的 node role，并且只沿该 role 声明的 topology 继续解析。

## 安全不变量

- Rule 在读取 request input 前，必须先通过 `direct_peer_nodes` 证明 direct socket peer。
- 递归 rule 只有在当前 role 允许某个 node 且该 node 能证明相邻 IP 时，才能跨越该 chain hop。
- Header chain 的元素位置必须保留。空元素和非法元素都是 hard boundary，不得在遍历前被删除。
- Secret bridge header 每次请求只能证明一个相邻 hop，不能证明 direct socket peer，也不能跨越任意多个未知 hop。
- 已认领 malformed input 的 rule 必须返回 `Rejected`；低优先级 rule 不能重新解释该输入。
- Secret bridge header 的名称和值不会复制到解析结果或 warning fields 中。

## 配置模型

`RealIpResolveConfig` 只有三个顶层字段：

- `rules`：request-input parser 与 graph 入口。
- `nodes`：hop evidence 与 topology role。
- `fallback`：没有 rule 适用时的行为。

顶层对象采用严格解析。未知字段会导致反序列化失败，而不是静默产生仅使用 fallback 的 resolver。Node 和 rule 名称必须唯一，所有被引用 node 必须存在。

```toml
[real_ip_resolve.fallback]
strategy = "remote-addr"
```

`remote-addr` 是目前唯一的 fallback strategy，返回状态为 `Fallback` 的 direct socket peer。

## Rules

Rule 按 `priority` 从高到低执行，相同优先级按定义顺序执行。第一个 `Resolved` 或 `Rejected` 结果会终止计算；`not_applicable` 允许继续执行下一条 rule。

推荐按输入权威性设置优先级：

1. `proxy-protocol`
2. `trusted-resolved-header`
3. `x-forwarded-for`
4. `forwarded`

PROXY protocol metadata 和 resolved-IP header 通常更权威，因为可信上游会直接给出单一结果。XFF 通常高于 Forwarded，因为很多旧代理更稳定地实现了 XFF append 语义。这只是部署建议，并非硬编码顺序。

每条 rule 都需要：

- `name`：唯一 rule 名称。
- `direct_peer_nodes`：允许证明 direct socket peer 的 roles。
- `priority`：可选整数，默认 `0`。

### X-Forwarded-For

```toml
[[real_ip_resolve.rules]]
name = "xff"
kind = "x-forwarded-for"
priority = 200
headers = ["x-forwarded-for"]
direction = "right-to-left"
direct_peer_nodes = ["local"]
```

- `headers` 默认为 `x-forwarded-for`。配置多个名称时，选择第一个实际存在的名称。
- 被选 header 的多个 field occurrence 按接收顺序连接。
- `direction` 默认为 `right-to-left`，对应常规 wire 形式 `client, proxy-1, proxy-2`。
- `left-to-right` 用于明确采用反向 chain 格式的场景。
- 每个逗号分隔元素都必须是 IP address。

### RFC 7239 Forwarded

```toml
[[real_ip_resolve.rules]]
name = "forwarded"
kind = "forwarded"
priority = 100
headers = ["forwarded"]
direction = "right-to-left"
param = "for"
direct_peer_nodes = ["local"]
```

- `headers` 默认为 `forwarded`，alternative-name 和 repeated-field 行为与 XFF 相同。
- `param` 默认为 `for`，不接受其它参数。
- 每个 Forwarded element 都必须包含 IP 类型的 `for` 参数。Obfuscated identifier、缺少 `for` 和 malformed element 都是 rejected boundary。

### Trusted Resolved Header

```toml
[[real_ip_resolve.rules]]
name = "resolved-real-ip"
kind = "trusted-resolved-header"
priority = 300
headers = ["x-trusted-real-ip"]
direct_peer_nodes = ["local"]
skip_if_matches_nodes = ["local", "cdn"]
```

- 被选 header 必须恰好出现一次并且只包含一个 IP address。
- Header 缺失时该 rule 为 not applicable。
- 重复、非文本或非 IP value 会在 direct peer 处产生 `Rejected`。
- `skip_if_matches_nodes` 是可选字段。如果 candidate 仍能被其中某个 role 证明，该 rule 会变为 not applicable，让低优先级 chain rule 继续解析。

Skip list 是显式配置，不会从其它位置加载的所有 CIDR 中隐式推导。

### PROXY Protocol

```toml
[[real_ip_resolve.rules]]
name = "proxy-protocol"
kind = "proxy-protocol"
priority = 400
direct_peer_nodes = ["local"]
```

Host 必须提供 `TransportContext.proxy_protocol_addr`。没有该 address 时，rule 为 not applicable。SecurityDept server 当前使用默认 transport context 调用 resolver，因此 server integration 必须先接入 PROXY protocol metadata，该 rule 才能解析请求。

## Node Graph

一个 node 同时涉及两类含义：

- Leaf node 提供 evidence，例如 CIDR match 或 bridge proof。
- Role node 提供 graph identity 与 `accepts_from` topology。

Standalone leaf 同时也是自己的 role。Union 会创建一个由多个 leaf 支撑的新 role。成功诊断会同时保留两类身份：

```text
role_name = "cdn"
evidence_name = "cloudflare"
```

Leaf 的通用字段为：

- `name`：唯一 node 名称。
- `priority`：可选整数，默认 `0`。
- `accepts_from`：当前 role 紧邻 clientward 方向允许出现的 roles。
- `allow_multiple_unions`：可选 boolean，默认 `false`。

Role candidate 按 role priority 从高到低匹配，相同值按定义顺序匹配。Role 内部的 leaves 按 leaf priority 从高到低匹配，相同值同样按定义顺序匹配。

### CIDR Nodes

| Kind | 必填字段 | 可选行为 |
| --- | --- | --- |
| `cidrs-inline` | `cidrs` | 静态 IP/CIDR entries。 |
| `cidrs-local-file` | `path` | `watch`、`debounce`、`max_stale`。 |
| `cidrs-remote-file` | `urls` | `refresh`、`timeout`、`on_refresh_failure`、`max_stale`。 |
| `cidrs-command` | `command` | `args`、`refresh`、`timeout`、`on_refresh_failure`、`max_stale`。 |
| `docker` | 无 | `host`、`networks` 与 dynamic-node 通用字段；要求 `docker` feature。 |
| `kube` | 无 | Kubernetes query fields 与 dynamic-node 通用字段；要求 `kube` feature。 |

File 和 command output 接受按行、逗号或 ASCII whitespace 分隔的 IP/CIDR。`#` 表示行内注释开始。空输出和非法 entry 会导致加载失败。

Remote-file node 会合并所有配置 URL 的内容。任意 URL 失败都会使本次 load attempt 失败。

Docker 行为：

- `host` 可以选择 Docker endpoint。
- `networks` 接受字符串或列表；省略时检查所有可见 network。
- CIDR 来自 Docker network IPAM subnet。

Kubernetes 行为：

- `resource` 默认为 `pods`，支持 `pods`、`endpoints`、`endpoint-slices` 与 `endpointslices`。
- `namespace`、`resource_name`、`label_selector`、`field_selector` 和 `kubeconfig_path` 用于限制 query。
- `endpoints` 要求 `namespace`；提供 `resource_name` 时只读取单个 Endpoints object。

### Dynamic CIDR 生命周期

Resolver 构造时会对每个 CIDR-backed node 执行初次加载。任意初次加载失败都会阻止 resolver 创建。

- `refresh` 为 remote、command、Docker、Kubernetes 和 custom CIDR node 安排周期 reload。
- `watch = true` 会在 filesystem event 后重新加载本地文件；`debounce` 默认为两秒。
- `on_refresh_failure = "keep-last-good"` 是默认策略，会保留上一个 snapshot。
- `on_refresh_failure = "clear"` 会删除失败 node 的 snapshot。
- `max_stale` 会让过旧 snapshot 停止参与匹配，即使它仍被保留。
- Drop `CidrNodeRegistry` 会中断 refresh 与 file-watch tasks。

### Trusted Bridge Headers

```toml
[[real_ip_resolve.nodes]]
name = "edgeone"
kind = "trusted-bridge-headers"
headers = ["EO-RANDOM-SECRET-Client-IP"]
```

假设按 app-to-client 方向遍历时，当前 chain IP 是无法通过 CIDR 识别的 proxy `P`，紧邻 clientward 的下一个 chain IP 是 `C`。只有当某个尚未消费的已配置 header 恰好出现一次，且其值严格等于 `C` 时，该 node 才能证明 `P`。

匹配后，该 header name 会在本次请求中被消费，不能继续证明另一个 hop。不同 bridge header 可以分别证明多层相邻 CDN。

缺失、重复、malformed 或不匹配的 bridge value 不会 reject request；它们只代表无法证明 `P`，因此 `P` 会成为正常 resolved boundary。Bridge node 需要合法的 clientward peek IP，所以无法证明 direct socket peer。

Secret header 是上游 integration 提供的 evidence，不是 origin isolation 的替代品。可信路径必须移除外部传入的同名 header，并自行设置 secret header。

可通过以下命令生成 header 名称中使用的 opaque bearer：

```sh
securitydept-cli realip header create-secret-bearer
```

该命令输出 URL-safe token。将其嵌入 provider-specific header 名称，例如
`EO-<secret_bearer>-Client-IP`；不要把 token 作为 header value，value 仍必须是紧邻的 clientward IP。

### Union 与多归属

```toml
[[real_ip_resolve.nodes]]
name = "cdn"
kind = "union"
members = ["cloudflare", "edgeone"]
accepts_from = ["cdn"]
```

Union membership 可以嵌套，但 membership graph 必须无环。完成传递归属展开后，一个 leaf 默认只能属于一个 union；只有该 leaf 显式设置 `allow_multiple_unions = true` 时才能多归属。

启用多归属后，每个 `(role, evidence)` match 仍然相互独立。共享同一 leaf 的其它 role 不会合并自己的 `accepts_from`。

`accepts_from` 可以包含自环或环。每个成功 transition 都会消费一个 clientward chain element，因此 topology cycle 不会造成无限遍历。

## 递归解析

XFF 和 Forwarded rule 按以下步骤解析：

1. 使用 `direct_peer_nodes` 证明 direct socket peer，并建立其 role/evidence identity。
2. 按配置方向遍历已解析 chain。
3. 相邻 IP 只能与当前 role 的 `accepts_from` roles 匹配。
4. CIDR-backed node 直接证明相邻 IP；bridge node 还要求下一个 clientward IP 与未消费的 matching secret header。
5. Node 命中后消费该 IP，切换到 matched role 并继续。
6. 如果合法 IP 没有 node 命中，将该 IP 作为不可信 client boundary 返回，状态为 `Resolved`。
7. 如果整条 chain 都被证明，返回最远 clientward 的已证明 IP，状态同样为 `Resolved`。

例如，socket peer 为 `192.168.1.3`，XFF 为 `192.168.1.1, 192.168.1.2`，且 `lan` role 接受自身时，最终解析为 `192.168.1.1`，而不是 socket peer。

## 结果与失败语义

```rust
pub struct ResolvedClientIp {
    pub client_ip: std::net::IpAddr,
    pub peer_ip: std::net::IpAddr,
    pub rule_name: Option<String>,
    pub input_kind: ResolvedInputKind,
    pub status: RealIpResolutionStatus,
    pub matched_nodes: Vec<ResolvedNodeMatch>,
}
```

`status` 是互斥状态：

- `Resolved`：rule 返回合法边界，包括合法但不可信的 IP，或者全链已证明时最远的 IP。
- `Fallback`：没有 rule 适用，`client_ip` 为 direct socket peer。
- `Rejected { reason }`：已认领 input 中存在 malformed boundary，`client_ip` 为此前最近的已证明安全 hop。

稳定 rejection reasons 为：

- `MalformedHeaderValue`
- `MalformedChainElement`
- `MissingForwardedFor`

需要区分：

- Rule input 缺失表示 not applicable，允许低优先级 rule 继续。
- Rule input 已存在但 malformed 表示 rejected，并终止 rule evaluation。
- 合法但无法证明的 IP 是成功 resolved boundary，不是 error。
- 非法 bridge proof 是 unproven-hop boundary，不是 malformed chain syntax。

Resolver 会为 `Rejected` 发出 secret-safe warning，但不会把客户端可控 malformed input 转换为 resolver error 或稳定 5xx response。

`matched_nodes` 包含 direct peer match，以及之后每个已证明 chain hop；不包含最终合法但未证明的 client boundary。

## Access Policy

`RealIpAccessManager` 在解析后应用 allowlist：

```toml
[basic_auth_context.real_ip_access]
allowed_cidrs = ["10.0.0.0/8", "192.168.0.0/16"]
allow_fallback = false
```

- `allowed_cidrs` 不得为空。
- `Rejected` 无条件拒绝。
- `Fallback` 只有在 `allow_fallback = true` 时允许。
- 其它可接受结果仍必须属于 `allowed_cidrs`。

配置 `basic_auth_context.real_ip_access` 时，SecurityDept server 要求同时配置 `[real_ip_resolve]`。

## 完整示例

```toml
[real_ip_resolve.fallback]
strategy = "remote-addr"

[[real_ip_resolve.rules]]
name = "resolved-real-ip"
kind = "trusted-resolved-header"
priority = 300
headers = ["x-trusted-real-ip"]
direct_peer_nodes = ["local"]
skip_if_matches_nodes = ["local", "cdn"]

[[real_ip_resolve.rules]]
name = "x-forwarded-for"
kind = "x-forwarded-for"
priority = 200
headers = ["x-forwarded-for"]
direction = "right-to-left"
direct_peer_nodes = ["local"]

[[real_ip_resolve.rules]]
name = "forwarded"
kind = "forwarded"
priority = 100
headers = ["forwarded"]
direction = "right-to-left"
param = "for"
direct_peer_nodes = ["local"]

[[real_ip_resolve.nodes]]
name = "localhost"
kind = "cidrs-inline"
cidrs = ["127.0.0.1/32", "::1/128"]

[[real_ip_resolve.nodes]]
name = "lan"
kind = "cidrs-inline"
cidrs = ["192.168.0.0/16"]

[[real_ip_resolve.nodes]]
name = "docker"
kind = "docker"
networks = ["bridge"]
refresh = "30s"
on_refresh_failure = "keep-last-good"
max_stale = "10m"

[[real_ip_resolve.nodes]]
name = "local"
kind = "union"
members = ["localhost", "lan", "docker"]
accepts_from = ["local", "cdn"]

[[real_ip_resolve.nodes]]
name = "cloudflare"
kind = "cidrs-remote-file"
urls = [
  "https://www.cloudflare.com/ips-v4",
  "https://www.cloudflare.com/ips-v6",
]
refresh = "24h"
timeout = "10s"
on_refresh_failure = "keep-last-good"
max_stale = "7d"

[[real_ip_resolve.nodes]]
name = "edgeone"
kind = "trusted-bridge-headers"
headers = ["EO-RANDOM-SECRET-Client-IP"]

[[real_ip_resolve.nodes]]
name = "cdn"
kind = "union"
members = ["cloudflare", "edgeone"]
accepts_from = ["cdn"]
```

在标准 right-to-left XFF traversal 中，该 graph 允许 local hops 后连接任意数量 CDN hops。Cloudflare hop 通过 CIDR 证明，EdgeOne hop 通过相邻 secret-header relation 证明。

## Rust API 与 Custom Nodes

```rust
use securitydept_realip::{RealIpResolver, TransportContext};

let resolver = RealIpResolver::from_config(config).await?;
let resolved = resolver
    .resolve(peer_ip, &headers, &TransportContext::default())
    .await;
```

Custom CIDR node kind 需要实现 `CustomCidrNodeFactory` 和 `DynamicCidrNode`。将 custom factory 与已启用 built-ins 一起注册，再通过 `from_config_with_factories` 构造 resolver：

```rust
use securitydept_realip::extension::CidrNodeFactoryRegistry;

let mut factories = CidrNodeFactoryRegistry::with_builtin_nodes()?;
factories.register(my_factory)?;
let resolver = RealIpResolver::from_config_with_factories(config, &factories).await?;
```

Custom node config 会获得通用 graph/refresh fields，并保留 flattened kind-specific fields。

## 验证

```bash
cargo test -p securitydept-realip
cargo test -p securitydept-realip --lib --all-features
cargo test -p securitydept-realip --test docker --features docker
just e2e-rs
just e2e-rs-hot
just e2e-rs-isolated
just clean-kube-test-artifacts
```

Docker integration tests 从 Docker IPAM 推导预期 CIDR。Kubernetes e2e helper 只创建和清理带 SecurityDept label 的测试资源。

---

[English](../en/006-REALIP.md) | [中文](006-REALIP.md)
