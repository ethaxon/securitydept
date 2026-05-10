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
- Kubernetes e2e support is owned by `scripts/test-cli.ts`, not by shell logic in `justfile`. It builds or reuses labeled helper/runtime images, creates SecurityDept-prefixed kind/k3d resources, and exposes cleanup commands that remove only SecurityDept test artifacts.
- Docker-provider integration tests should derive expected bridge CIDRs from Docker network IPAM metadata instead of hardcoding host-specific subnets; this avoids pool-overlap failures on machines with different local Docker allocations.
- Docker-provider assertions should stay minimal: if a test only needs Docker network IPAM metadata, do not start an extra helper container just to prove the network exists.

Run focused provider tests and local e2e loops with:

```bash
cargo test -p securitydept-realip --test core_providers
just e2e-rs
just e2e-rs-hot
just e2e-rs-isolated
just clean-kube-test-artifacts
```

`just e2e-rs` reuses labeled local clusters when possible but stops the reusable containers after the run. `just e2e-rs-hot` keeps them running for repeated fast loops. `just e2e-rs-isolated` creates disposable clusters for a stricter cleanup path.

---

[English](006-REALIP.md) | [中文](../zh/006-REALIP.md)
