# Real-IP Strategy

`securitydept-realip` resolves the effective client IP across trusted network boundaries such as `client -> CDN -> load balancer -> reverse proxy -> app`.

Core rule: **never trust client-IP headers unless the direct peer is a configured trusted peer.**

## Model

- **Providers** supply trusted CIDR sets. Built-in provider kinds include `inline`, `local-file`, `remote-file`, `command`, `docker-provider`, and `kube-provider`.
- **Sources** bind providers to parsing policy: which headers or transport metadata may be trusted for peers from that provider.
- **Fallback** defines behavior when the direct peer does not match any trusted source. The normal fallback is the socket peer address.

Avoid blanket-trusting entire private networks such as `10.0.0.0/8`; trust the specific ingress components instead.

## Resolution Pipeline

1. Read the socket peer address.
2. Match the peer against configured trusted sources.
3. If a source matches, parse only the inputs allowed by that source, such as PROXY protocol, `CF-Connecting-IP`, `X-Forwarded-For`, or `Forwarded`.
4. If no source matches, return the socket peer address.

## API Shape

Applications receive a deterministic result:

```rust
pub struct ResolvedClientIp {
    pub client_ip: std::net::IpAddr,
    pub peer_ip: std::net::IpAddr,
    pub source_name: Option<String>,
    pub source_kind: ResolvedSourceKind,
    pub header_name: Option<String>,
}
```

## Testing Strategy

- Unit tests cover parser and IP normalization behavior.
- Core integration tests cover `inline`, `local-file`, `remote-file`, and `command` providers with isolated components.
- Containerized provider tests cover Docker and Kubernetes provider behavior through real local infrastructure when those tests are explicitly selected.

Run focused provider tests with:

```bash
cargo test -p securitydept-realip --test core_providers
```

---

[English](006-REALIP.md) | [中文](../zh/006-REALIP.md)
