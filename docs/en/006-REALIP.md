# Real-IP Strategy

`securitydept-realip` resolves an effective client IP across mixed proxy boundaries such as:

```text
client -> CDN -> reverse proxy -> container network -> application
```

The resolver does not treat every configured CIDR as one global trusted set. It proves each adjacent hop against an explicit node role and only follows topology declared by that role.

## Security Invariants

- A rule must prove the direct socket peer through `direct_peer_nodes` before reading its request input.
- A recursive rule may cross a chain hop only when the current role permits a node that proves the adjacent IP.
- Header-chain positions are preserved. Empty or malformed elements are hard boundaries and are never removed before traversal.
- A secret bridge header can prove one adjacent hop per request. It cannot prove the direct socket peer or skip an arbitrary number of unknown hops.
- A rule that has claimed malformed input returns `Rejected`; lower-priority rules cannot reinterpret that input.
- Secret bridge header names and values are not copied into resolution results or warning fields.

## Configuration Model

`RealIpResolveConfig` has three top-level fields:

- `rules`: request-input parsers and graph entry points.
- `nodes`: hop evidence and topology roles.
- `fallback`: behavior when no rule applies.

The top-level object is strict. Unknown fields fail deserialization rather than silently producing a fallback-only resolver. Node and rule names must be unique, and every referenced node must exist.

```toml
[real_ip_resolve.fallback]
strategy = "remote-addr"
```

`remote-addr` is currently the only fallback strategy. It returns the direct socket peer with status `Fallback`.

## Rules

Rules run by descending `priority`; definition order breaks ties. The first `Resolved` or `Rejected` outcome terminates evaluation. A `not_applicable` rule allows the next rule to run.

Recommended priority follows input authority:

1. `proxy-protocol`
2. `trusted-resolved-header`
3. `x-forwarded-for`
4. `forwarded`

PROXY protocol metadata and resolved-IP headers are normally more authoritative because a trusted upstream supplies a single result. XFF usually precedes Forwarded because many older proxies implement XFF append behavior more consistently. This is a deployment recommendation, not a hard-coded ordering.

Every rule requires:

- `name`: unique rule name.
- `direct_peer_nodes`: roles allowed to prove the direct socket peer.
- `priority`: optional integer, default `0`.

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

- `headers` defaults to `x-forwarded-for`. If several names are configured, the first present name is selected.
- Multiple field occurrences of the selected header are concatenated in received order.
- `direction` defaults to `right-to-left`, which matches the normal wire form `client, proxy-1, proxy-2`.
- `left-to-right` supports a deliberately reversed chain format.
- Every comma-separated element must be an IP address.

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

- `headers` defaults to `forwarded` and follows the same alternative-name and repeated-field behavior as XFF.
- `param` defaults to `for`; no other parameter is accepted.
- Each Forwarded element must contain an IP-valued `for` parameter. Obfuscated identifiers, missing `for`, and malformed elements are rejected boundaries.

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

- The selected header must occur exactly once and contain one IP address.
- A missing header makes the rule not applicable.
- Duplicate, non-text, or non-IP values produce `Rejected` at the direct peer.
- `skip_if_matches_nodes` is optional. If the candidate is still proven by one of those roles, the rule becomes not applicable so a lower-priority chain rule can continue.

The skip list is explicit. It does not infer trust from all CIDRs loaded elsewhere.

### PROXY Protocol

```toml
[[real_ip_resolve.rules]]
name = "proxy-protocol"
kind = "proxy-protocol"
priority = 400
direct_peer_nodes = ["local"]
```

The host must provide `TransportContext.proxy_protocol_addr`. If no address is present, the rule is not applicable. The SecurityDept server currently calls the resolver with a default transport context, so a server integration must add PROXY protocol metadata before this rule can resolve requests.

## Node Graph

A node has two related meanings:

- A leaf node supplies evidence, such as a CIDR match or a bridge proof.
- A role node supplies graph identity and `accepts_from` topology.

A standalone leaf is also its own role. A union creates another role backed by one or more leaf nodes. Successful diagnostics retain both identities:

```text
role_name = "cdn"
evidence_name = "cloudflare"
```

Common leaf fields are:

- `name`: unique node name.
- `priority`: optional integer, default `0`.
- `accepts_from`: roles allowed immediately clientward of this role.
- `allow_multiple_unions`: optional boolean, default `false`.

Role candidates are matched by descending role priority, then definition order. Leaves inside a role are matched by descending leaf priority, then definition order.

### CIDR Nodes

| Kind | Required fields | Optional behavior |
| --- | --- | --- |
| `cidrs-inline` | `cidrs` | Static IP/CIDR entries. |
| `cidrs-local-file` | `path` | `watch`, `debounce`, `max_stale`. |
| `cidrs-remote-file` | `urls` | `refresh`, `timeout`, `on_refresh_failure`, `max_stale`. |
| `cidrs-command` | `command` | `args`, `refresh`, `timeout`, `on_refresh_failure`, `max_stale`. |
| `docker` | none | `host`, `networks`, and common dynamic-node fields. Requires the `docker` feature. |
| `kube` | none | Kubernetes query fields and common dynamic-node fields. Requires the `kube` feature. |

File and command output accepts IPs or CIDRs separated by lines, commas, or ASCII whitespace. `#` starts a line comment. Empty output and malformed entries fail the load.

Remote-file contents are combined across every configured URL. A failure from any URL fails that load attempt.

Docker behavior:

- `host` optionally selects the Docker endpoint.
- `networks` accepts a string or list. If omitted, all visible networks are inspected.
- CIDRs come from Docker network IPAM subnets.

Kubernetes behavior:

- `resource` defaults to `pods`; supported values are `pods`, `endpoints`, `endpoint-slices`, and `endpointslices`.
- `namespace`, `resource_name`, `label_selector`, `field_selector`, and `kubeconfig_path` refine the query.
- `endpoints` requires `namespace`; `resource_name` selects one Endpoints object when present.

### Dynamic CIDR Lifecycle

Resolver construction performs an initial load for every CIDR-backed node. Initial failure prevents resolver creation.

- `refresh` schedules periodic reloads for remote, command, Docker, Kubernetes, and custom CIDR nodes.
- `watch = true` reloads a local file after filesystem events; `debounce` defaults to two seconds.
- `on_refresh_failure = "keep-last-good"` is the default and retains the previous snapshot.
- `on_refresh_failure = "clear"` removes the failed node snapshot.
- `max_stale` makes an old snapshot stop matching even when it is retained.
- Dropping `CidrNodeRegistry` aborts refresh and file-watch tasks.

### Trusted Bridge Headers

```toml
[[real_ip_resolve.nodes]]
name = "edgeone"
kind = "trusted-bridge-headers"
headers = ["EO-RANDOM-SECRET-Client-IP"]
```

During app-to-client traversal, assume the current chain IP is an otherwise unknown proxy `P`, and the immediately clientward chain IP is `C`. This node proves `P` only when an unused configured header occurs exactly once and its value is exactly `C`.

After a match, that header name is consumed for the request. The same header cannot prove another hop. Different bridge headers may prove multiple adjacent CDN layers.

Missing, duplicate, malformed, or non-matching bridge values do not reject the request. They simply fail to prove `P`, so `P` becomes the normal resolved boundary. A bridge node needs a valid clientward peek IP and therefore cannot prove the direct socket peer.

The secret header is evidence from an upstream integration, not a substitute for origin isolation. The trusted path must strip external copies and set the secret header itself.

Generate the opaque header-name bearer with:

```sh
securitydept-cli realip header create-secret-bearer
```

The command returns a URL-safe token. Embed it in the provider-specific header
name, for example `EO-<secret_bearer>-Client-IP`; never use the token as the
header value, which must remain the adjacent clientward IP.

### Unions and Multiple Membership

```toml
[[real_ip_resolve.nodes]]
name = "cdn"
kind = "union"
members = ["cloudflare", "edgeone"]
accepts_from = ["cdn"]
```

Union membership may be nested, but the membership graph must be acyclic. After transitive membership expansion, a leaf may belong to only one union unless that leaf explicitly sets `allow_multiple_unions = true`.

When multiple membership is enabled, each `(role, evidence)` match remains independent. `accepts_from` is not merged from other roles that share the same leaf.

`accepts_from` may contain self-loops or cycles. This is safe because each successful transition consumes one clientward chain element.

## Recursive Resolution

For XFF and Forwarded rules, resolution proceeds as follows:

1. Prove the direct socket peer against `direct_peer_nodes` and establish its role/evidence identity.
2. Traverse the parsed chain in the configured direction.
3. Match the adjacent IP only against the current role's `accepts_from` roles.
4. CIDR-backed nodes prove the adjacent IP directly. A bridge node additionally requires the next clientward IP and an unused matching secret header.
5. If a node matches, consume the IP, switch to the matched role, and continue.
6. If no node matches a valid IP, return that IP as the untrusted client boundary with status `Resolved`.
7. If the whole chain is proven, return the farthest clientward proven IP with status `Resolved`.

For example, if the socket peer is `192.168.1.3` and XFF is `192.168.1.1, 192.168.1.2`, a `lan` role that accepts itself resolves to `192.168.1.1`, not the socket peer.

## Result and Failure Semantics

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

`status` is mutually exclusive:

- `Resolved`: a rule returned a valid boundary, including a valid untrusted IP or the farthest fully proven IP.
- `Fallback`: no rule applied; `client_ip` is the direct socket peer.
- `Rejected { reason }`: a claimed input contained a malformed boundary; `client_ip` is the nearest previously proven safe hop.

Stable rejection reasons are:

- `MalformedHeaderValue`
- `MalformedChainElement`
- `MissingForwardedFor`

Important distinctions:

- Missing rule input is not applicable and permits lower-priority rules.
- Present malformed rule input is rejected and terminates rule evaluation.
- A valid but unproven IP is a successful resolved boundary, not an error.
- An invalid bridge proof is an unproven-hop boundary, not malformed chain syntax.

The resolver emits a secret-safe warning for `Rejected` but does not turn client-controlled malformed input into a resolver error or stable 5xx response.

`matched_nodes` contains the direct peer match followed by each proven chain hop. It does not include the final valid but unproven client boundary.

## Access Policy

`RealIpAccessManager` applies an allowlist after resolution:

```toml
[basic_auth_context.real_ip_access]
allowed_cidrs = ["10.0.0.0/8", "192.168.0.0/16"]
allow_fallback = false
```

- `allowed_cidrs` must not be empty.
- `Rejected` is always denied.
- `Fallback` is denied unless `allow_fallback = true`.
- An otherwise acceptable result must still belong to `allowed_cidrs`.

The SecurityDept server requires `[real_ip_resolve]` whenever `basic_auth_context.real_ip_access` is configured.

## Complete Example

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

With a standard right-to-left XFF traversal, this graph permits local hops followed by any number of CDN hops. A Cloudflare hop is proven by CIDR; an EdgeOne hop is proven by the adjacent secret-header relation.

## Rust API and Custom Nodes

```rust
use securitydept_realip::{RealIpResolver, TransportContext};

let resolver = RealIpResolver::from_config(config).await?;
let resolved = resolver
    .resolve(peer_ip, &headers, &TransportContext::default())
    .await;
```

Custom CIDR node kinds implement `CustomCidrNodeFactory` and `DynamicCidrNode`. Register custom factories alongside enabled built-ins, then construct the resolver with `from_config_with_factories`:

```rust
use securitydept_realip::extension::CidrNodeFactoryRegistry;

let mut factories = CidrNodeFactoryRegistry::with_builtin_nodes()?;
factories.register(my_factory)?;
let resolver = RealIpResolver::from_config_with_factories(config, &factories).await?;
```

Custom node configuration receives common graph and refresh fields plus flattened kind-specific fields.

## Verification

```bash
cargo test -p securitydept-realip
cargo test -p securitydept-realip --lib --all-features
cargo test -p securitydept-realip --test docker --features docker
just e2e-rs
just e2e-rs-hot
just e2e-rs-isolated
just clean-kube-test-artifacts
```

Docker integration tests derive expected CIDRs from Docker IPAM. Kubernetes e2e helpers create and clean only SecurityDept-labeled test resources.

---

[English](006-REALIP.md) | [中文](../zh/006-REALIP.md)
