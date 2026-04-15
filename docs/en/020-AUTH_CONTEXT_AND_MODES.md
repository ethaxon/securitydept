# Auth Context and Modes Design

> This document defines the unified meanings of `auth context``zone``mode`,
> and the related product/authority surfaces in the securitydept auth stack.  
> It replaces the previous split documentation for auth contextsbasic-auth
> zonesand the OIDC mode family.

The role of this document is to:

- explain the conceptual layering of auth context / zone / mode
- explain Rust- and TS-side ownership boundaries
- explain which structures are top-level contexts, which are modes, and which are only internal substrates

This document does **not** try to:

- list the current TS public package / subpath capability snapshot: see [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)
- define current priorities, backlog, or deferred boundaries: see [100-ROADMAP.md](100-ROADMAP.md)
- serve as the migration history: see [110-TS_SDK_MIGRATIONS.md](110-TS_SDK_MIGRATIONS.md)

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
- how protocol primitives such as redirecttransportand pending OAuth state are expressed

The application layer answers:

- who the authenticated user is
- where auth state lives
- how frontend and backend divide runtime and authority
- how the application logs inrestoresrefresheslogs outand forwards bearer material

## 2. Terminology

### 2.1 `auth context`

An `auth context` is the top-level application-facing authentication integration surface.  
It defines:

- the ownership model of auth state
- the split of frontend/backend responsibilities
- the higher-level contract for redirectpersistencetransportand principals

There are currently three formal auth contexts:

- `basic-auth-context`
- `session-context`
- `token-set-context`

### 2.2 `zone`

A `zone` is not its own auth contextand it is not a mode.  
`zone` exists only inside `basic-auth-context`where it describes:

- which route area belongs to the same Basic Auth challenge boundary
- the login / logout / post-auth redirect rules for that boundary
- optional `real_ip_access` restrictions

### 2.3 `mode`

A `mode` is also not its own auth context.  
`mode` exists only inside `token-set-context`, where it describes the OIDC integration shape for that context.

`token-set-context` currently has exactly two formal modes:

- `frontend-oidc`
- `backend-oidc`

Within `backend-oidc`, `backend-oidc-pure` and `backend-oidc-mediated` should no longer be read as peer first-level modes. They are presets / profiles inside `backend-oidc`.

### 2.4 Public surfaces and ownership boundaries

This project also distinguishes two kinds of structure:

- **public surface**: the crate / package / subpath / module that adopters enter directly
- **ownership boundary**: the module or logical layer responsible for generating or interpreting config / contracts / runtime policy

This is especially important for `token-set-context`:

- TS public surface: `token-set-context-client` plus its mode-aligned / shared subpath family
- Rust public surface: the canonical target has converged on `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate, orchestration, models}`
- Rust ownership boundary: the implementation may still distinguish mode-specific contract authority from shared runtime substrate ownership, but that should not keep driving the first-level public namespace

## 3. Auth Context Overview

| Auth Context | Best for | State ownership | Internal subdivision | Main product surfaces |
|---|---|---|---|---|
| `basic-auth-context` | browser-native Basic Auth where OIDC would be too heavy | browser credential cache, challenge routes | `zone` | Rust: `securitydept-basic-auth-context`; TS: `basic-auth-context-client` |
| `session-context` | centralized services, BFFs, weak frontend capability | backend session store, HTTP-only cookie | no mode family | Rust: `securitydept-session-context` (route helpers now directly available via `service` feature); TS: `session-context-client` |
| `token-set-context` | strong frontend capability, distributed SPAs, shared frontend/backend OIDC ownership | determined by the concrete mode | `frontend-oidc` / `backend-oidc` (presets: `pure`, `mediated`) | Rust: `securitydept-token-set-context`; TS: `token-set-context-client` |

The required hierarchy is:

- `zone` belongs to `basic-auth-context`
- `mode` belongs to `token-set-context`
- `session-context` is its own auth contextnot a mode family

## 4. `basic-auth-context`

### 4.1 Role

`basic-auth-context` is the smallest auth context.  
It does not depend on OIDCand it does not participate in the token-set mode family.

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

`session-context` is the statefulcookie-based auth context.  
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
This is its own auth contextnot a mode inside `token-set-context`.

### 5.3 Main composition

`session-context` mainly composes:

- `securitydept-oidc-client`
- `securitydept-session-context`
- `service` feature: `SessionAuthServiceTrait``OidcSessionAuthService``DevSessionAuthService` (now directly in this crate)
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

`token-set-context` is the auth context that spans frontend token runtimebackend OIDC runtimeand cross-boundary transport contracts.

It is not just an old “token-set flow” label.  
More accurately:

- `token-set-context` is the top-level auth context
- its internal subdivision is the OIDC mode family

### 6.2 Public surfaces and ownership boundaries

`token-set-context` should currently be read in two layers:

| Surface | Entry | Responsibility | Current status |
|---|---|---|---|
| TS frontend runtime surface | `token-set-context-client` | unified frontend mode-aligned subpath / adapter / runtime surface | has converged into `/backend-oidc-mode`, `/frontend-oidc-mode`, and `/access-token-substrate` |
| Rust crate public surface | `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode, access_token_substrate, orchestration, models}` | top-level `*_mode` / shared-module structure for adopters | public surface is converged |
| Rust ownership boundary | mode-specific config / contract ownership, shared runtime substrate ownership | the internal explanation of “who owns what” | real, but should not remain the first-level public namespace |

The key decisions are:

- `securitydept-token-set-context` must not be read as “just the backend crate”
- the Rust public API is better expressed directly as top-level `*_mode` and shared modules than by forcing adopters through a first-level `frontend` / `backend` split
- “the backend does not run a given frontend flow” does not mean “Rust does not need the corresponding mode module or contract authority”

The current structural reality is:

- `backend-oidc` is the backend OIDC mode, providing presets such as `pure` and `mediated`
- OIDC protocol flows (authorize / callback / refresh / exchange) are provided by `OidcClient`; the identity extraction (principal / issuer) shared by both backend presets has been pushed down into `securitydept-oidc-client::auth_state`
- backend-oidc runtimes handle capability-specific post-processing (sealed refresh vs plain, metadata fallback, redirect policy, and so on)
- `backend-oidc` should expose an explicit `user_info` exchange contract: `id_token` in the request body plus bearer `access_token` in the request header
- but the protocol composition behind that `user_info` path is better pushed down into `securitydept-oidc-client`: parse ID-token claims (with server-side nonce skipping where appropriate), call userinfo, then run `check_claims`
- the mode layer should keep only the endpoint owner, request/response contract, and route/auth/policy ownership
- `frontend-oidc` has no backend runtime, but it now owns formal `Config / ResolvedConfig / ConfigSource / Runtime / Service / ConfigProjection`

### 6.3 Canonical modes and presets/profiles

`token-set-context` should now use exactly these formal modes:

| Mode | Who runs the OIDC flow | TS canonical subpath | Rust authority / runtime |
|---|---|---|---|
| `frontend-oidc` | frontend (browser) | `/frontend-oidc-mode` | `securitydept-token-set-context::frontend_oidc_mode` |
| `backend-oidc` | backend | `/backend-oidc-mode` | `securitydept-token-set-context::backend_oidc_mode` |

These are internal details and have been unified under:

- `backend-oidc` integrating all preset logic internally
- `/backend-oidc-mode` as its only frontend/backend communication layer

These legacy public names are no longer canonical:

- `/token-set`
- `/oidc`
- `/oidc-mediated`

#### 6.3.1 `backend-oidc` presets / profiles

`backend-oidc` should stably support at least these preset bundles:

| Preset / Profile | Meaning | Default capability bundle |
|---|---|---|
| `pure` | minimal backend OIDC baseline | `refresh_material_protection = passthrough``metadata_delivery = none``post_auth_redirect_policy = caller_validated` |
| `mediated` | backend OIDC with custody / policy augmentation | `refresh_material_protection = sealed``metadata_delivery = redemption``post_auth_redirect_policy = resolved` |

These presets are recommended capability bundles, not additional first-level mode names.

#### 6.3.2 `backend-oidc` capability axes

`backend-oidc` should stop being implemented as “two modes with two long-lived API shapes” and instead converge on one capability framework. The key capability axes are:

- `refresh_material_protection`
  - `passthrough`
  - `sealed`
- `metadata_delivery`
  - `none`
  - `redemption`
- `post_auth_redirect_policy`
  - `caller_validated`
  - `resolved`

Token propagation is **not** a `backend-oidc` capability axis. It is a cross-mode capability owned by `access_token_substrate` (`TokenPropagation` / `AccessTokenSubstrateRuntime`).


Two things must stay explicit:

- `metadata_redemption` is an independent payload delivery mechanismwhereas user-info retrieval is an inherent baseline behavior of the backend OIDC client
- `backend-oidc-pure` / `backend-oidc-mediated` are just recommended preset bundles on top of these axes

### 6.3.1 Route-service ownership

Route-facing services now live directly in their owning crates:

- `BackendOidcModeAuthService` (formerly `TokenSetAuthService`) → `securitydept-token-set-context::backend_oidc_mode`
- `AccessTokenSubstrateResourceService` (formerly `TokenSetResourceService`) → `securitydept-token-set-context::access_token_substrate`
- `SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService` → `securitydept-session-context` (`service` feature)

The `securitydept-auth-runtime` aggregation layer has been dissolved and removed from the workspace.

### 6.4 Shared OIDC configuration authority

`OidcSharedConfig` should be read as the shared OIDC configuration authority for the Rust public surface of `token-set-context`not as a backend-only helper.

It serves both:

- backend runtime/config resolution
- frontend config projection

When a single OIDC provider serves multiple rolesit should remain valid to share provider-connectivity config through an `[oidc]` alias block such as:

```toml
[oidc]
well_known_url = "https://auth.example.com/.well-known/openid-configuration"

[oidc_client]
client_id = "my-app"
client_secret = "secret"
redirect_url = "/auth/session/callback"

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
In particular, `redirect_url` should now be read as an explicit per-flow path: for example, session uses `/auth/session/callback`, while token-set uses `/auth/token-set/callback`.

### 6.4.1 Unified `backend-oidc` configuration direction

But the canonical direction has been merged into:

- `BackendOidcModeConfig`
- `ResolvedBackendOidcModeConfig`
- `BackendOidcModeConfigSource`

`BackendOidcModeConfigSource` exposes two component accessor / resolve-helper pairs:

- `oidc_client_raw_config` → `resolve_oidc_client` (applies `[oidc]` shared defaults)
- `runtime_config` → `resolve_runtime` (validates `BackendOidcModeRuntimeConfig`, which contains the 3 capability axes)
- `resolve_all` (recommended entry point — resolves all backend-oidc components in one step)

The 3 capability axes (`refresh_material_protection`, `metadata_delivery`, `post_auth_redirect_policy`) are internal fields of `BackendOidcModeRuntimeConfig`, validated collectively by `resolve_runtime`, not individual methods on the config-source trait. Token propagation is a separate concern owned by `access_token_substrate`, not a field of `BackendOidcModeRuntimeConfig`.

The goal is therefore:

- one backend-oidc capability config-source trait (3 componentsresolve_all)
- multiple validated preset/profile bundles
- one core implementation instead of two long-lived parallel config systems

### 6.5 `frontend-oidc`

In `frontend-oidc` mode:

- the browser runs authorize / callback / token-exchange via `oauth4webapi`
- the Rust backend does not run that flow runtime
- but Rust still must project frontend-consumable configas well as the mode-specific integration contracts that let `frontend-oidc` interoperate with `access_token_substrate`through `securitydept-token-set-context::frontend_oidc_mode`

So the correct reading is:

- `frontend-oidc` has no backend runtime
- but it **does** have a formal Rust mode module
- that module is no longer just a config producer; once `frontend-oidc` also participates in resource-server / propagation / forwarder semanticsit must define the mode-qualified integration contracts that connect `frontend-oidc` to `access_token_substrate`
- those contracts should express how frontend-produced token / auth-state material is formally consumed by the backend and the shared substraterather than re-exporting the substrate runtime itself under the mode module

### 6.6 `backend-oidc`

`backend-oidc` should be read as one backend OIDC capability frameworknot as two long-lived parallel modes:

- the backend runs a standard OIDC client and cooperates with a resource-server verifier
- OIDC protocol flows (authorize / callback / refresh / exchange) are provided by `OidcClient`
- identity extraction shared across presets is pushed down into `securitydept-oidc-client::auth_state`
- runtime layers own only capability-specific augmentation (refresh-material protection, metadata delivery, redirect policy, and so on)
- the canonical browser-facing callback / refresh contract should use unified mode-qualified contracts
- `user_info` is a formal `backend-oidc` capability: `id_token` in the request body, bearer `access_token` in the request header
- the protocol composition behind `user_info` belongs in `securitydept-oidc-client`, while `backend-oidc` owns endpoint ownership, mode-qualified request/response contracts, and route/auth/policy boundaries

More concretely`backend-oidc` should unify:

- code authorize
- callback
- refresh
- token exchange
- user-info / claims-normalization integration
- the boundary to `access_token_substrate`

while `pure` / `mediated` become presets that add different capability bundles on top of the same baseline.

#### 6.6.1 `backend-oidc` and presets

The canonical public surface for `backend-oidc` has successfully converged on:

- TS: `/backend-oidc-mode`
- Rust: `securitydept-token-set-context::backend_oidc_mode`

#### 6.6.2 Typical presets

`backend-oidc` currently needs at least these two representative presets:

- `pure`
  - `refresh_material_protection = passthrough`
  - `metadata_delivery = none`
  - `post_auth_redirect_policy = caller_validated`
- `mediated`
  - `refresh_material_protection = sealed`
  - `metadata_delivery = redemption`
  - `post_auth_redirect_policy = resolved`

The more accurate relationship is:

- `mediated` = `backend-oidc` baselinecustody / policy augmentation
- not another long-lived first-class mode

### 6.7 Current implementation

The code has now successfully converged on:

- one `backend-oidc` core implementation
- one capability schema / validation layer
- one canonical frontend-facing subpath
- pure / mediated retained only as presets / profiles or capability preconfigurations

### 6.8 Current root-level misclassification

There is still a large set of materials under `packages/token-set-context/src/` that remain flattened at the crate root even though they no longer belong there conceptually:

| Current material | Correct home |
|---|---|
| `runtime.rs`, `metadata_redemption/*`, `refresh_material.rs` | preset-specific runtime domain of `backend-oidc` (currently mainly the mediated preset) |
| `propagation/*`, `forwarder/*`, resource-server-facing access-token / downstream forwarding policy | cross-mode access-token substrate inside `token-set-context` |
| mediated-specific runtime / policy parts in `redirect.rs` | preset-specific runtime domain of `backend-oidc` (currently mainly the mediated preset) |
| query / payload / callback/refresh return / redemption request/response contracts in `transport.rs` | `securitydept-token-set-context::backend_oidc_mode` cross-boundary contract surface |

So:

- `metadata_redemption` is not a generic root capability
- `BackendOidcMediatedModeRuntime` should not keep being read as a long-lived first-class mode runtime; it is more accurately a runtime augmentation for one `backend-oidc` preset
- `propagation` / `forwarder` should not remain hard-bound to `backend-oidc-mediated`
- `transport.rs` should not remain a root-level contract miscellany forever

### 6.9 Access-token substrate: resource-serverpropagationforwarder

Inside `token-set-context`there is a set of downstream access-token capabilities that should no longer be classified by a specific OIDC mode:

- resource-server-facing access-token contracts
- bearer propagation
- forwarding / same-resource proxy glue

They share the same core property:

- they only care whether an access token existswhether it is verifiableand what `X-SecurityDept-Propagation` says
- they do not care whether that access token originated from `frontend-oidc``backend-oidc-pure`or `backend-oidc-mediated`
- `backend-oidc-mediated` may reuse thembut it should not be treated as their exclusive runtime home

So the current correct boundary is:

- propagation policy should no longer be modeled as a `backend_oidc_mode` capability axis; it belongs to the capability/config/runtime surface of `access_token_substrate`
- auth-state metadata no longer carries propagation policy
- resource-token facts should not be mixed into frontend auth-state metadata
- the shared contracts for resource-server / forwarder / propagation should be promoted into a cross-mode substrate within `token-set-context`rather than left under mediated-specific directory semantics

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
The cleaner substrate shape should continue to converge on:

- `access_token_substrate::capabilities::TokenPropagation`
- `access_token_substrate::AccessTokenSubstrateConfig`
- `access_token_substrate::AccessTokenSubstrateRuntime`
- `access_token_substrate::forwarder::PropagationForwarderConfigSource`
- `access_token_substrate::forwarder::PropagationForwarder`

Within that shape:

- `TokenPropagation` belongs to the capability/config dimension of `access_token_substrate`, not to `backend_oidc_mode`
- `AccessTokenSubstrateRuntime` is responsible for token propagation runtime behavior: it holds `token_propagator` and provides `propagation_enabled()` and `build_forwarder()`; it does **not** hold the `OAuthResourceServerVerifier`
- `PropagationForwarderConfigSource` constrains the config shape of a forwarder integration
- `PropagationForwarder` constrains the runtime API shape of that forwarder
- a forwarder remains an app-level feature layered above the substrate runtime, not something pushed back into the OIDC mode runtime

That substrate should also connect cleanly to the top-level mode modules:

- `securitydept-token-set-context::access_token_substrate` owns the capability / config / runtime / service / forwarder trait boundary, plus resource verification, propagation policy, and header attachment
- `securitydept-token-set-context::{frontend_oidc_mode, backend_oidc_mode}` should own the config / runtime / service / transport contracts for those formal modes while staying focused on OIDC client / mode concerns
- `securitydept-token-set-context::orchestration` and `::models` should only carry truly shared abstractions, not pretend to be a mode
- the TS frontend product surface should consume only the contracts it actually needs, rather than reading mode-agnostic access-token substrate as mediated-only capability

This point needs to stay explicit:

- do not create an empty shadow namespace just to mirror `access_token_substrate`
- and do not keep `frontend` / `backend` as the first-level public namespaces for adopter-facing Rust APIs
- the current stable interaction between `frontend-oidc` and backend / substrate remains bearer access tokens plus endpoint-specific input, not a separate mode-qualified token handoff DTO family

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
- only `token-set-context` has `mode`; its formal modes are now `frontend-oidc` and `backend-oidc`with pure / mediated retained as backend-oidc presets
- `session-context` is its own auth context and must not be collapsed into the mode family

That means future docscratesTS subpathsand public symbols should all converge on this hierarchy rather than mixing `context``zone`and `mode` at one level again.

---

[English](020-AUTH_CONTEXT_AND_MODES.md) | [中文](../zh/020-AUTH_CONTEXT_AND_MODES.md)
