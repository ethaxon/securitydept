# Real-IP 策略

`securitydept-realip` 用于跨 trusted network boundaries 解析 effective client IP，例如 `client -> CDN -> load balancer -> reverse proxy -> app`。

核心规则：**除非直接 peer 是已配置的 trusted peer，否则永远不要信任 client-IP headers。**

## 模型

- **Providers** 提供 trusted CIDR sets。内置 provider kinds 包括 `inline`、`local-file`、`remote-file`、`command`、`docker-provider` 与 `kube-provider`。
- **Sources** 将 providers 绑定到解析策略：来自该 provider 的 peer 可以信任哪些 headers 或 transport metadata。
- **Fallback** 定义直接 peer 不匹配任何 trusted source 时的行为。通常 fallback 是 socket peer address。

避免粗暴信任整个私有网段，例如 `10.0.0.0/8`；应只信任具体 ingress components。

## 解析流程

1. 读取 socket peer address。
2. 将 peer 匹配到 configured trusted sources。
3. 如果命中 source，只解析该 source 允许的输入，例如 PROXY protocol、`CF-Connecting-IP`、`X-Forwarded-For` 或 `Forwarded`。
4. 如果没有命中 source，返回 socket peer address。

## API Shape

应用获得确定性的解析结果：

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

- Unit tests 覆盖 parser 与 IP normalization 行为。
- Core integration tests 通过隔离组件覆盖 `inline`、`local-file`、`remote-file` 与 `command` providers。
- Containerized provider tests 在显式选择时通过真实本地基础设施覆盖 Docker 与 Kubernetes provider behavior。
- Docker-provider integration tests 应从 Docker network 的 IPAM metadata 推导预期 bridge CIDR，而不是硬编码某个宿主机相关的 subnet；这样可以避免不同机器上的 Docker address pool overlap 失败。
- Docker-provider assertion 应保持最小化：如果测试只需要 Docker network 的 IPAM metadata，就不要额外启动 helper container 仅仅为了证明网络存在。

运行 focused provider tests：

```bash
cargo test -p securitydept-realip --test core_providers
```

---

[English](../en/006-REALIP.md) | [中文](006-REALIP.md)
