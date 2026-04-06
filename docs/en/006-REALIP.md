# Real IP Strategy

`securitydept-realip` handles real-IP resolution across multiple trusted network boundaries (e.g.`Client -> CDN -> L4 LB -> Proxy -> app`). 

The core principle: **NEVER trust client-IP headers unless the connection comes directly from a verified trusted peer.**

## Core Model
- **Providers**: Supply trusted CIDR sets (e.g.from local configremote URLsDocker/Kube APIs).
- **Sources**: Map matched peer CIDRs to allowed parsing policies (which headers to trustand how).

### Resolution Pipeline
1. Check socket peer address.
2. Match peer against configured trusted `sources`.
3. If matchedparse allowed inputs (PROXY protocol -> single-hop headers like `CF-Connecting-IP` -> recursive `X-Forwarded-For`/`Forwarded`).
4. Fallback to socket peer address if no source matches.

## Configuration Shape
Configuration consists of three sections: `providers``sources`and `fallback`.

### 1. Providers
Define trusted boundaries. Built-in kinds:
- `inline`: Static CIDR list.
- `local-file`: CIDR list from file (supports `watch`).
- `remote-file`: Polled URLs (supports `refresh`).
- `command`: Discover CIDRs via script execution.
- `docker-provider`: Discovers ingress networks via Docker API.
- `kube-provider`: Discovers ingress Pods/Endpoints via Kubernetes API.

*Note: Avoid blanket trusting entire private networks (e.g.`10.0.0.0/8`). Narrow trust to specific ingress components.*

### 2. Sources
Define trust handling for matched providers:
- `peers_from`: Provider names.
- `accept_headers`: Allowed headers (e.g.`cf-connecting-ip` (single)`x-forwarded-for` (recursive right-to-left)).
- `accept_transport`: e.g.`proxy-protocol`.

### 3. Fallback
Behavior when no source matches. Usually `remote-addr`.

## API Shape
Exposes a deterministic result to the application middleware:
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
The crate employs three levels of testing to ensure correctness without flakiness:
1. **Unit Tests (`src/*`)**: Fast validation of logicparsingand IP normalization.
2. **Core Integration Tests (`tests/core_providers.rs`)**: Validates standard providers (`inline``local-file``command``remote-file`) using mocked sockets and isolated temporary componentstesting refresh/watch routines.
3. **Containerized Provider Tests (`tests/docker_provider.rs``tests/kube_provider.rs`)**: 
   - Spins up real `testcontainers` infrastructure.
   - Bootstraps real Docker networks or ephemeral Kubernetes (Kind/K3d) clusters.
   - Deploys test proxies (e.g.Traefiknative PodsServices) and validates IP resolution synchronously using `kube-integration-test` or `docker` features.
   - Run tests selectively via `cargo test -p securitydept-realip --test [test_name]`.

---

[English](006-REALIP.md) | [中文](../zh/006-REALIP.md)
