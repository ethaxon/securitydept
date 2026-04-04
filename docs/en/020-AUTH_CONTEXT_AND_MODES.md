# Auth Context and Modes Design

> This document defines the unified meanings of `auth context`, `zone`, `mode`,
> and the related product/authority surfaces in the securitydept auth stack.  
> It replaces the previous split documentation for auth contexts, basic-auth
> zones, and the OIDC mode family.

## 1. Core Layering

The securitydept auth stack should be read in two layers:

- **lower capability layer**
  - `securitydept-creds`
  - `securitydept-creds-manage`
  - `securitydept-oidc-client`
  - `securitydept-oauth-resource-server`
  - `securitydept-oauth-provider`
- **application integration layer**
  - `basic-auth-context`
  - `session-context`
  - `token-set-context`

The lower layer answers:

- how credentials or tokens are obtained
- how bearer tokens are verified
- how metadata / JWKS are refreshed
- how protocol primitives such as redirect, transport, and pending OAuth state are expressed

The application layer answers:

- who the authenticated user is
- where auth state lives
- how frontend and backend divide runtime and authority
- how the application logs in, restores, refreshes, logs out, and forwards bearer material

## 2. Terminology

### 2.1 `auth context`

An `auth context` is the top-level application-facing authentication integration surface.  
It defines:

- the ownership model of auth state
- the split of frontend/backend responsibilities
- the higher-level contract for redirect, persistence, transport, and principals

There are currently three formal auth contexts:

- `basic-auth-context`
- `session-context`
- `token-set-context`

### 2.2 `zone`

A `zone` is not its own auth context, and it is not a mode.  
`zone` exists only inside `basic-auth-context`, where it describes:

- which route area belongs to the same Basic Auth challenge boundary
- the login / logout / post-auth redirect rules for that boundary
- optional `real_ip_access` restrictions

### 2.3 `mode`

A `mode` is also not its own auth context.  
`mode` exists only inside `token-set-context`, where it describes the OIDC integration shape for that context.

`token-set-context` currently has exactly three formal modes:

- `frontend-oidc`
- `backend-oidc-pure`
- `backend-oidc-mediated`

### 2.4 Public surfaces and ownership boundaries

This project also distinguishes two kinds of structure:

- **public surface**: the crate, package, subpath, or module that adopters enter directly
- **ownership boundary**: the module or logical layer responsible for generating or interpreting config, contracts, or runtime policy

This is especially important for `token-set-context`:

- TS public surface: `token-set-context-client` plus its mode-aligned / shared subpath family
- Rust public surface: `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_pure_mode, backend_oidc_mediated_mode, access_token_substrate, orchestration, models}`
- Rust ownership boundary: the implementation may still distinguish mode-specific contract authority from shared runtime substrate ownership, but that should not keep driving the first-level public namespace

## 3. Auth Context Overview

| Auth Context | Best for | State ownership | Internal subdivision | Main product surfaces |
|---|---|---|---|---|
| `basic-auth-context` | browser-native Basic Auth where OIDC would be too heavy | browser credential cache + challenge routes | `zone` | Rust: `securitydept-basic-auth-context`; TS: `basic-auth-context-client` |
| `session-context` | centralized services, BFFs, weak frontend capability | backend session store + HTTP-only cookie | no mode family | Rust: `securitydept-session-context` (route helpers now directly available via `service` feature); TS: `session-context-client` |
| `token-set-context` | strong frontend capability, distributed SPAs, shared frontend/backend OIDC ownership | determined by the concrete mode | `frontend-oidc` / `backend-oidc-pure` / `backend-oidc-mediated` | Rust: `securitydept-token-set-context`; TS: `token-set-context-client` |

The required hierarchy is:

- `zone` belongs to `basic-auth-context`
- `mode` belongs to `token-set-context`
- `session-context` is its own auth context, not a mode family

## 4. `basic-auth-context`

### 4.1 Role

`basic-auth-context` is the smallest auth context.  
It does not depend on OIDC, and it does not participate in the token-set mode family.

It mainly composes:

- `securitydept-creds`
- `securitydept-creds-manage`
- optional `securitydept-realip`
- optional server route helpers
- optional `basic-auth-context-client`

### 4.2 Zone model

The internal shape of `basic-auth-context` should be read as:

- global basic-auth-context settings
- one or more `zone` definitions
- each zone having its own challenge / login / logout / post-auth redirect rules
- each zone optionally carrying `real_ip_access`

So `basic auth zone` must always be read as:

- an internal subdivision of `basic-auth-context`

not as:

- a standalone auth context
- a document topic separate from `basic-auth-context`

### 4.3 Recommended UX pattern

A modern SPA should not let arbitrary API calls trigger the browser’s native Basic Auth dialog accidentally.  
The recommended pattern is:

- ordinary JSON APIs return `401` **without** `WWW-Authenticate`
- a dedicated challenge route returns `401` **with** `WWW-Authenticate: Basic`
- a successful challenge redirects back into the application

That keeps the browser-native dialog opt-in rather than accidental.

### 4.4 Logout constraint

Browsers do not expose a standard JavaScript API for clearing cached Basic Auth credentials.  
So `basic-auth-context` has to accept this reality:

- logout may still rely on classic credential poisoning
- send deliberately invalid Basic Auth credentials to a dedicated logout route
- return `401` without `WWW-Authenticate`
- let the browser replace its cached credential silently

### 4.5 Client helper scope

`basic-auth-context-client` should stay thin.  
It only needs to help with:

- zone-aware `401 -> login` redirection
- logout URL / logout helper behavior

It should not become another large frontend runtime.

## 5. `session-context`

### 5.1 Role

`session-context` is the stateful, cookie-based auth context.  
It fits:

- centralized services
- BFFs
- weak frontend capability

### 5.2 Ownership model

In `session-context`:

- OIDC login and callback are handled by the backend
- the backend stores or manages the auth context
- the browser mainly carries an HTTP-only session cookie
- the `me` endpoint returns a normalized principal

There is no `mode family` here.  
This is its own auth context, not a mode inside `token-set-context`.

### 5.3 Main composition

`session-context` mainly composes:

- `securitydept-oidc-client`
- `securitydept-session-context`
- `service` feature: `SessionAuthServiceTrait`, `OidcSessionAuthService`, `DevSessionAuthService` (now directly in this crate)
- optional `tower-sessions-*` stores
- optional TS redirect-to-login helpers

### 5.4 Redirect target restriction

`post-auth redirect` targets should not be treated as unchecked raw redirect strings.  
They should keep following the shared redirect-target restriction model.

The long-term direction is:

- route-facing session services have been moved directly into `securitydept-session-context` (via the `service` feature)
- `securitydept-auth-runtime` no longer appears as a formal product surface for `session-context`

## 6. `token-set-context`

### 6.1 Role

`token-set-context` is the auth context that spans frontend token runtime, backend OIDC runtime, and cross-boundary transport contracts.

It is not just an old “token-set flow” label.  
More accurately:

- `token-set-context` is the top-level auth context
- its internal subdivision is the OIDC mode family

### 6.2 Public surfaces and ownership boundaries

`token-set-context` should currently be read in two layers:

| Surface | Entry | Responsibility | Current status |
|---|---|---|---|
| TS frontend runtime surface | `token-set-context-client` | unified frontend mode-aligned subpath / adapter / runtime surface | exists |
| Rust crate public surface | `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_pure_mode, backend_oidc_mediated_mode, access_token_substrate, orchestration, models}` | top-level `*_mode` + shared-module structure for adopters | canonical shape implemented; legacy `frontend` / `backend` internal directories physically deleted |
| Rust ownership boundary | mode-specific config / contract ownership + shared runtime substrate ownership | the internal explanation of “who owns what” | real, but should not remain the first-level public namespace |

The key decisions are:

- `securitydept-token-set-context` must not be read as “just the backend crate”
- the Rust public API is better expressed directly as top-level `*_mode` and shared modules than by forcing adopters through a first-level `frontend` / `backend` split
- “the backend does not run a given frontend flow” does not mean “Rust does not need the corresponding mode module or contract authority”

Both structural changes have been completed:

- route-facing token-set services have been moved back into `securitydept-token-set-context` as mode-specific and shared-substrate services
- the `backend-oidc-mediated` configuration surface has been reshaped from a raw/resolved pair into a composable config-source trait plus a distinct resolved bundle

### 6.3 Canonical mode names and TS subpaths

`token-set-context` uses exactly these formal modes:

| Mode | Who runs the OIDC flow | TS canonical subpath | Rust authority / runtime |
|---|---|---|---|
| `frontend-oidc` | frontend (browser) | `/frontend-oidc-mode` | `securitydept-token-set-context::frontend_oidc_mode` |
| `backend-oidc-pure` | backend | `/backend-oidc-pure-mode` | `securitydept-token-set-context::backend_oidc_pure_mode` |
| `backend-oidc-mediated` | backend (mediated) | `/backend-oidc-mediated-mode` | `securitydept-token-set-context::backend_oidc_mediated_mode` |

These legacy public names are no longer canonical:

- `/token-set`
- `/oidc`
- `/oidc-mediated`

### 6.3.1 Route-service ownership

Route-facing services now live directly in their owning crates:

- `BackendOidcMediatedModeAuthService` (formerly `TokenSetAuthService`) → `securitydept-token-set-context::backend_oidc_mediated_mode`
- `AccessTokenSubstrateResourceService` (formerly `TokenSetResourceService`) → `securitydept-token-set-context::access_token_substrate`
- `SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService` → `securitydept-session-context` (`service` feature)

The `securitydept-auth-runtime` aggregation layer has been dissolved and removed from the workspace.

### 6.4 Shared OIDC configuration authority

`OidcSharedConfig` should be read as the shared OIDC configuration authority for the Rust public surface of `token-set-context`, not as a backend-only helper.

It serves both:

- backend runtime/config resolution
- frontend config projection

When a single OIDC provider serves multiple roles, it should remain valid to share provider-connectivity config through an `[oidc]` alias block such as:

```toml
[oidc]
well_known_url = "https://auth.example.com/.well-known/openid-configuration"

[oidc_client]
client_id = "my-app"
client_secret = "secret"
redirect_url = "/auth/callback"

[oauth_resource_server]
audiences = ["api://my-app"]
required_scopes = ["entries.read"]
```

The core shareable fields remain:

- `well_known_url`
- `issuer_url`
- `jwks_uri`
- metadata / JWKS refresh intervals

while fields such as `scopes`, `audiences`, and `redirect_url` remain role-specific and should not be flattened into one generic default.

### 6.4.1 `backend-oidc-mediated` configuration — current state

`backend-oidc-mediated` now uses:

- `BackendOidcMediatedConfig` (raw input)
- `ResolvedBackendOidcMediatedConfig` (resolved bundle)
- `BackendOidcMediatedConfigSource` trait — composable config-source trait for adopters, with individual resolve entry points:
  - `resolve_oidc_client`
  - `resolve_oauth_resource_server`
  - `resolve_mediated_runtime`
  - `resolve_token_propagation`
  - `resolve_all` (convenience: resolves all at once)

Adopters can compose individual resolvers rather than being limited to one monolithic `resolve_all()` entry.

### 6.5 `frontend-oidc`

In `frontend-oidc` mode:

- the browser runs authorize / callback / token-exchange via `oauth4webapi`
- the Rust backend does not run that flow runtime
- but Rust still must project frontend-consumable config, as well as the mode-specific integration contracts that let `frontend-oidc` interoperate with `access_token_substrate`, through `securitydept-token-set-context::frontend_oidc_mode`

So the correct reading is:

- `frontend-oidc` has no backend runtime
- but it **does** have a formal Rust mode module
- that module is no longer just a config producer; once `frontend-oidc` also participates in resource-server / propagation / forwarder semantics, it must define the mode-qualified integration contracts that connect `frontend-oidc` to `access_token_substrate`

### 6.6 `backend-oidc-pure`

In `backend-oidc-pure` mode:

- the backend runs a standard OIDC client + resource-server verifier
- the frontend usually receives opaque sessions, tokens, or protocol-agnostic material
- the formal frontend-facing entry should be `/backend-oidc-pure-mode`

Even if the initial `backend-oidc-pure-mode` surface is thin and only contains:

- config projection
- requirement / guard contracts
- transport contracts

it is still a formal mode-aligned surface, not an optional mirror to add later.

### 6.7 `backend-oidc-mediated`

In `backend-oidc-mediated` mode:

- the backend mediates provider interaction
- the frontend never talks to the provider directly
- the mode-specific capabilities include:
  - sealed refresh material
  - metadata redemption
  - post-auth redirect policy

Those mediated-specific capabilities still need to split into two layers:

1. **backend runtime / policy**
   - `BackendOidcMediatedModeRuntime`
   - `metadata_redemption`
   - refresh-material protection
   - redirect resolution
2. **frontend-consumable cross-boundary contracts**
   - authorize query
   - refresh payload
   - redirect fragments
   - metadata redemption request / response

The first layer belongs to the `backend-oidc-mediated` backend runtime.  
The second layer should be projected through `securitydept-token-set-context::backend_oidc_mediated_mode`, then consumed by:

- `/backend-oidc-mediated-mode`
- `/backend-oidc-mediated-mode/web`
- `/backend-oidc-mediated-mode/react`

### 6.8 Current root-level misclassification

There is still a large set of materials under `packages/token-set-context/src/` that remain flattened at the crate root even though they no longer belong there conceptually:

| Current material | Correct home |
|---|---|
| `runtime.rs`, `metadata_redemption/*`, `refresh_material.rs` | `backend-oidc-mediated` runtime domain |
| `propagation/*`, `forwarder/*`, resource-server-facing access-token / downstream forwarding policy | cross-mode access-token substrate inside `token-set-context` |
| mediated-specific runtime / policy parts in `redirect.rs` | `backend-oidc-mediated` runtime domain |
| query / payload / fragment / redemption request/response contracts in `transport.rs` | `securitydept-token-set-context::backend_oidc_mediated_mode` cross-boundary contract surface |

So:

- `metadata_redemption` is not a generic root capability
- `BackendOidcMediatedModeRuntime` is not a root-level product surface parallel to every mode
- `propagation` / `forwarder` should not remain hard-bound to `backend-oidc-mediated`
- `transport.rs` should not remain a root-level contract miscellany forever

### 6.9 Access-token substrate: resource-server, propagation, forwarder

Inside `token-set-context`, there is a set of downstream access-token capabilities that should no longer be classified by a specific OIDC mode:

- resource-server-facing access-token contracts
- bearer propagation
- forwarding / same-resource proxy glue

They share the same core property:

- they only care whether an access token exists, whether it is verifiable, and what `X-SecurityDept-Propagation` says
- they do not care whether that access token originated from `frontend-oidc`, `backend-oidc-pure`, or `backend-oidc-mediated`
- `backend-oidc-mediated` may reuse them, but it should not be treated as their exclusive runtime home

So the current correct boundary is:

- propagation policy is owned by server configuration
- auth-state metadata no longer carries propagation policy
- resource-token facts should not be mixed into frontend auth-state metadata
- the shared contracts for resource-server / forwarder / propagation should be promoted into a cross-mode substrate within `token-set-context`, rather than left under mediated-specific directory semantics

At runtime the design should continue to distinguish:

- `AuthenticatedPrincipal`
- `ResourceTokenPrincipal`
- `PropagatedBearer`
- `TokenPropagator`

`TokenPropagator` owns:

- destination allowlists
- issuer / audience / scope / `azp` validation
- attachment and validation of `PropagatedBearer`

Neither `TokenPropagator` nor the forwarder layered above it is a full reverse proxy.  
A recommended future forwarder should be layered above this substrate rather than forcing it to absorb the full responsibility for `Forwarded` / `X-Forwarded-*`.

That substrate should also connect cleanly to the top-level mode modules:

- `securitydept-token-set-context::access_token_substrate` owns runtime policy, resource verification, forwarding policy, and header attachment
- `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_pure_mode, backend_oidc_mediated_mode}` each own the config / requirement / transport / integration contracts for that mode
- `securitydept-token-set-context::orchestration` and `::models` should only carry truly shared abstractions, not pretend to be a mode
- the TS frontend product surface should consume only the contracts it actually needs, rather than reading mode-agnostic access-token substrate as mediated-only capability

This point needs to stay explicit:

- do not create an empty shadow namespace just to mirror `access_token_substrate`
- and do not keep `frontend` / `backend` as the first-level public namespaces for adopter-facing Rust APIs
- once `frontend-oidc` needs to connect obtained access tokens to resource-server / propagation / forwarder semantics, `securitydept-token-set-context::frontend_oidc_mode` must expose a formal, mode-qualified integration contract for it to interoperate with `securitydept-token-set-context::access_token_substrate`

## 7. Shared Abstraction Direction

The most important abstractions to keep coherent across auth contexts are:

- `AuthenticatedPrincipal`
- `AuthenticationSource`
- `AuthTokenSnapshot`
- `AuthTokenDelta`
- `AuthStateMetadataSnapshot`
- `AuthStateMetadataDelta`
- `AuthStateSnapshot`
- `AuthStateDelta`
- `PendingAuthStateMetadataRedemption`

But these abstractions must not blur the hierarchy again:

- `zone` still belongs only to `basic-auth-context`
- `mode` still belongs only to `token-set-context`

## 8. Current Overall Judgment

The most important thing to protect in the current auth design is not more vocabulary. It is stable layering:

- `auth context` is the top-level application integration surface
- only `basic-auth-context` has `zone`
- only `token-set-context` has `mode`
- `session-context` is its own auth context and must not be collapsed into the mode family

That means future docs, crates, TS subpaths, and public symbols should all converge on this hierarchy rather than mixing `context`, `zone`, and `mode` at one level again.

---

[English](020-AUTH_CONTEXT_AND_MODES.md) | [中文](../zh/020-AUTH_CONTEXT_AND_MODES.md)
