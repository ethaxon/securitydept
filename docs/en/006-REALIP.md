# Real IP Strategy

This document defines the planned real-IP strategy for future `securitydept-realip` work.

The target problem is not a single reverse proxy. It is stacked network boundaries such as:

- `Client -> CDN -> origin`
- `Client -> CDN A -> CDN B -> reverse proxy -> app`
- `Client -> L4 LB -> NGINX -> Traefik -> app`

The design goal is to resolve the effective client IP without trusting spoofable headers from untrusted peers.

## Scope

Planned crate: `securitydept-realip`

Responsibilities:

- normalize trusted peer CIDRs from multiple sources
- resolve the effective client IP from transport metadata and HTTP headers
- expose a deterministic resolution result for middleware and application code
- support background refresh for remote trusted-peer providers
- support local file watch for operator-managed trusted-peer lists

Out of scope:

- rate limiting
- geo-IP lookup
- WAF or bot detection
- request logging policy

## Core Model

The design should separate two concepts:

1. provider
2. source

A provider answers: where do trusted peer CIDRs come from?

A source answers: when the connected peer matches a trusted CIDR set, which transport or header inputs are allowed, and how are they parsed?

This avoids a dangerous global model such as "always trust `CF-Connecting-IP` first" or "always use `X-Forwarded-For`."

## Trust Boundary Rules

The default security model should be:

1. inspect the socket peer address first
2. match the peer against configured trusted source CIDRs
3. only after a source match, parse the transport/header fields allowed by that source
4. if no source matches, ignore all forwarded client-IP headers and use the socket peer address

This means client-IP headers are never trusted by themselves.

## Header and Transport Policy

The planned precedence is source-specific, not global.

### Preferred order

Inside a matched source, use the strongest available signal in this order:

1. PROXY protocol, when enabled for that trusted transport boundary
2. provider-specific single-value headers, but only for sources that are known to be single-hop at the edge
3. recursive chain parsing from `X-Forwarded-For`
4. recursive chain parsing from `Forwarded`
5. fallback to socket peer address

### `Forwarded`

`Forwarded` is the standards-based header and should be supported.

However, it should not be the only real-IP mechanism because many proxies and CDN products still rely on `X-Forwarded-For` for operational real-IP behavior.

### `X-Forwarded-For`

`X-Forwarded-For` should be a first-class chain input.

It must not be parsed by simply taking the left-most or right-most value. The parser should:

- split the chain into individual IP values
- process from right to left
- strip all trusted proxies/CDNs that are known internal hops
- return the first non-trusted IP as the effective client IP

This behavior is equivalent to the operational model behind recursive real-IP handling in common proxies.

### `X-Real-IP`

`X-Real-IP` should not be used as a public interoperability standard.

It may still be useful as an internal canonical header written by the first trusted reverse proxy after the external chain has already been validated and normalized.

### Provider-specific headers

Provider-specific single-value headers are only reliable when the provider is the outermost trusted edge.

Examples:

- `CF-Connecting-IP` is suitable when Cloudflare directly faces the end user.
- `CF-Connecting-IP` is not sufficient when Cloudflare itself sits behind another trusted CDN or proxy.
- `EO-Connecting-IP` should not be treated as the final client IP in stacked-proxy scenarios.

When a provider-specific header points to another trusted provider address, that is a signal that the current source is not the true outermost edge and chain parsing should continue.

## Stacked CDN Guidance

For a stacked deployment such as:

`Client -> EdgeOne -> Cloudflare -> origin`

the application must not assume `CF-Connecting-IP` is the final client IP.

Instead:

- verify that the socket peer belongs to Cloudflare
- inspect `CF-Connecting-IP`
- if that IP belongs to another configured trusted provider set, treat it as an intermediate trusted hop
- continue with recursive parsing of `X-Forwarded-For` or `Forwarded`
- only accept the single-value header directly when it does not resolve to another trusted provider and the source contract allows it

This is a heuristic safeguard, not the primary trust model. The primary model remains source-based trust plus recursive chain parsing.

## Configuration Model

The recommended configuration shape is:

- `providers`: define where trusted CIDRs come from
- `sources`: define which peer CIDRs map to which allowed parsing policies
- `fallback`: define behavior when no source matches

### Providers

Each provider should support one of:

- `inline`
- `local-file`
- `remote-file`
- `command`
- environment-specific dynamic providers

Recommended fields:

- `name`
- `kind`
- `cidrs` for inline providers
- `path` for local files
- `url` for remote files
- `command` and `args` for command providers
- `refresh` for remote polling
- `watch` and `debounce` for local files
- `timeout`
- `on_refresh_failure`
- `max_stale`

### Sources

Each source should support:

- `name`
- `priority`
- `peers_from`
- `accept_transport`
- `accept_headers`

Header and transport inputs should be represented explicitly instead of as plain strings. In particular:

- single-value headers such as `cf-connecting-ip`
- recursive chain inputs such as `x-forwarded-for`
- transport-level inputs such as PROXY protocol

### Fallback

The fallback should be explicit:

- `remote-addr`

This avoids ambiguous behavior when no trusted source matches.

## Dynamic Provider Guidance

Static providers are not sufficient for every deployment.

Containerized and orchestrated environments often allocate addresses dynamically. The design should therefore allow dynamic trusted-peer discovery in addition to static CIDR lists.

Recommended provider classes:

- `inline`
- `local-file`
- `remote-file`
- `command`
- optional environment-specific providers such as Docker or Kubernetes integrations

The critical rule is that dynamic providers should discover trusted ingress or proxy peers, not blindly trust an entire container or cluster network range.

### Command provider

A `command` provider is the most portable dynamic option.

It should execute a configured command, parse stdout as CIDRs or individual IPs, validate the result, and publish the new trusted set atomically.

Recommended fields:

- `name`
- `kind: command`
- `command`
- `args`
- `refresh`
- `timeout`
- `on_refresh_failure`
- `max_stale`

Recommended behavior:

- treat non-zero exit as refresh failure
- reject malformed output
- keep the last known good set on failure
- cap output size to avoid abuse or accidental explosions

The command provider allows operators to plug in their own environment logic without forcing `securitydept-realip` to embed every platform API.

Examples:

- inspect a Docker network and emit the current ingress subnet
- query Kubernetes Endpoints or EndpointSlice objects and emit ingress controller Pod IPs
- fetch addresses from an internal inventory or service-discovery system

### Environment-specific providers

The crate may later expose first-class providers such as:

- `docker-network`
- `docker-container-label`
- `kubernetes-pods`
- `kubernetes-endpoints`
- `kubernetes-endpointslice`

These providers should remain narrow in purpose. They should resolve addresses for trusted gateway components such as:

- ingress controllers
- reverse proxies
- edge gateways
- sidecars that are explicitly responsible for client-IP normalization

They should not default to trusting:

- every Pod CIDR
- every Service CIDR
- every Docker bridge subnet
- every node-private network

### Dedicated provider plugins

It is acceptable to add dedicated providers for deployment environments that have stable operational patterns.

Examples:

- a provider for a managed LB inventory API
- a provider for a private edge mesh control plane
- a provider for a specific internal gateway registry

The design should keep the provider interface narrow so these integrations can be added without changing the resolution engine.

## Container and Orchestration Networks

The warning against broad private-network trust does not mean containerized deployments cannot be supported.

It means the trust contract must be explicit.

Recommended order of preference:

1. trust explicit ingress or gateway addresses
2. use a dynamic provider to discover those addresses
3. only trust a broader container-network CIDR when the network is dedicated exclusively to trusted proxy infrastructure

Examples of acceptable broader trust:

- a private overlay used only by ingress gateway Pods
- a dedicated Docker network used only by NGINX and Traefik hops in front of the app

Examples of risky broad trust:

- the entire cluster Pod CIDR
- the entire Service CIDR
- the default Docker bridge range on a host that runs unrelated workloads

When a broad internal CIDR must be trusted, the source should ideally add at least one more constraint:

- internal-only bind address
- dedicated listener port
- PROXY protocol
- mTLS
- internal shared-secret header added by the trusted ingress tier

CIDR trust alone is too weak for mixed-use internal networks.

## Example Shape

```yaml
providers:
  - name: cloudflare-v4
    kind: remote-file
    url: https://www.cloudflare.com/ips-v4
    refresh: 6h
    timeout: 10s
    on_refresh_failure: keep-last-good
    max_stale: 7d

  - name: cloudflare-v6
    kind: remote-file
    url: https://www.cloudflare.com/ips-v6
    refresh: 6h
    timeout: 10s
    on_refresh_failure: keep-last-good
    max_stale: 7d

  - name: local-proxies
    kind: local-file
    path: ./config/trusted-proxies.txt
    watch: true
    debounce: 2s

  - name: discovered-ingress
    kind: command
    command: ./scripts/list-trusted-proxies.sh
    refresh: 30s
    timeout: 5s
    on_refresh_failure: keep-last-good
    max_stale: 10m

  - name: loopback
    kind: inline
    cidrs: ["127.0.0.1/32", "::1/128"]

sources:
  - name: cloudflare
    priority: 100
    peers_from: ["cloudflare-v4", "cloudflare-v6"]
    accept_headers:
      - kind: cf-connecting-ip
        mode: single
        use_only_if_not_in_trusted_peers: true
      - kind: x-forwarded-for
        mode: recursive
        direction: right-to-left
      - kind: forwarded
        mode: recursive
        direction: right-to-left
        param: for

  - name: internal-proxy
    priority: 50
    peers_from: ["local-proxies", "discovered-ingress", "loopback"]
    accept_transport:
      - kind: proxy-protocol
    accept_headers:
      - kind: x-forwarded-for
        mode: recursive
        direction: right-to-left
      - kind: forwarded
        mode: recursive
        direction: right-to-left
        param: for

fallback:
  strategy: remote-addr
```

## Trusted CIDR Provider Rules

Trusted CIDRs should not be compiled in as a single static list.

The module should support multiple providers because real deployments often combine:

- CDN provider ranges
- cloud load balancer ranges
- operator-maintained local proxy ranges
- loopback or explicitly allowed direct-access ranges

However, the implementation should avoid broad private-network trust by default. For example, blindly trusting all of `172.16.0.0/12` or `192.168.0.0/16` is usually too broad unless those ranges are dedicated only to trusted ingress infrastructure.

Prefer explicit ingress or proxy CIDRs over blanket private-network trust.

## Refresh and Watch Strategy

Remote providers should be refreshed asynchronously in the background.

Recommended behavior:

- start with a local cached snapshot if available
- apply refresh using atomic replacement only after validation succeeds
- keep the last known good set on refresh failure
- expose staleness state when `max_stale` is exceeded
- add jitter to polling intervals to avoid synchronized refresh storms

Local-file providers should support watch mode with debounce and validation before replacement.

Recommended defaults:

- Cloudflare IP lists: 6h to 24h refresh
- provider-managed ACL APIs with slower change rates: longer intervals such as 72h when documented
- local file watch debounce: 1s to 3s

## Conflict Handling

If two sources expand to overlapping trusted CIDRs, the configuration should not silently choose one by accident.

Recommended behavior:

- either reject overlapping source peer CIDRs at startup
- or require explicit `priority` and make conflict resolution deterministic

Silent ambiguity is not acceptable.

## API Shape

The crate should expose a middleware-friendly result object such as:

```rust
pub struct ResolvedClientIp {
    pub client_ip: std::net::IpAddr,
    pub peer_ip: std::net::IpAddr,
    pub source_name: Option<String>,
    pub source_kind: ResolvedSourceKind,
    pub header_name: Option<String>,
}
```

Application code should consume the resolved result instead of re-parsing headers.

## Boundary with Existing Utilities

The existing external-base-url logic in `packages/utils/src/base_url.rs` is about origin URL reconstruction, not real-IP trust resolution.

The future real-IP crate should not overload or hide that distinction.

---

[English](006-REALIP.md) | [中文](../zh/006-REALIP.md)
