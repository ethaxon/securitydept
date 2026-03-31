# OIDC Mode Family Design

> This document defines the unified OIDC mode family terminology and shared
> configuration model for the securitydept auth stack. It replaces the previous
> "three pillars" / "token-set" naming with a clearer, cross-stack vocabulary.

## 1. OIDC Mode Family

The auth stack supports three integration modes, all built on OIDC/OAuth 2.0:

| Mode | Who runs OIDC flows | Provider interaction | Key characteristics |
|---|---|---|---|
| `frontend-oidc` | Frontend (browser) | Direct | Browser handles authorize/callback/token-exchange via `oauth4webapi`; backend only serves config rules |
| `backend-oidc-pure` | Backend | Direct | Backend runs standard OIDC client; frontend receives opaque session or tokens |
| `backend-oidc-mediated` | Backend (mediated) | Isolated via backend | Backend runs enhanced OIDC with sealed refresh material, metadata redemption, post-auth redirect rules; frontend never touches provider directly |

### Why this replaces "three pillars" / "token-set"

- "Three pillars" was frontend-centric and didn't cover the backend side
- "Token-set" conflated a data structure name with a mode of operation
- The new terms clearly express *who runs the OIDC flow* and *how provider interaction is mediated*

### Product surface

| Surface | SDK / Crate | Role |
|---|---|---|
| **Frontend** | `token-set-context-client` (TS) | Unified frontend entry for all OIDC modes |
| **Backend** | `securitydept-token-set-context` (Rust) | Unified backend entry — `backend::BackendOidcPureRawConfig` / `BackendOidcMediatedRawConfig` |

### Mapping to backend entries

| Mode | Backend entry (via `token-set-context::backend`) | Description |
|---|---|---|
| `frontend-oidc` | (backend serves config only, no mode-level entry needed) | Backend returns OIDC config rules for frontend consumption |
| `backend-oidc-pure` | `BackendOidcPureRawConfig::resolve_config()` | Standard OIDC client + resource server |
| `backend-oidc-mediated` | `BackendOidcMediatedRawConfig::resolve_config()` | Enhanced OIDC with sealed refresh, metadata redemption, token propagation |

### Infrastructure layer (implementation crates)

| Crate | Scope | Adopter-facing? |
|---|---|---|
| `securitydept-oauth-provider` | OIDC discovery, JWKS, metadata refresh, `OidcSharedConfig` | No — re-exported via `backend` |
| `securitydept-oidc-client` | OIDC authorization code / device flows | No — re-exported via `backend` |
| `securitydept-oauth-resource-server` | JWT verification, introspection | No — re-exported via `backend` |
| `securitydept-utils` | Shared utilities | No |

## 2. Shared OIDC Configuration Model

### Current state — what's already shared

Both `securitydept-oidc-client` and `securitydept-oauth-resource-server` already flatten `OAuthProviderRemoteConfig` from `securitydept-oauth-provider`:

```rust
// Already shared via securitydept-oauth-provider
pub struct OAuthProviderRemoteConfig {
    pub well_known_url: Option<String>,   // OIDC discovery URL
    pub issuer_url: Option<String>,       // issuer identifier
    pub jwks_uri: Option<String>,         // JWKS endpoint
    pub metadata_refresh_interval: Duration,
    pub jwks_refresh_interval: Duration,
}
```

### Design: `oidc` alias block

For deployments where a single OIDC provider serves both roles, configuration should not be duplicated. The `oidc` alias block provides a fallback:

```toml
# Shared OIDC provider config — read by both oidc-client and resource-server
# when their local blocks don't specify these fields.
[oidc]
well_known_url = "https://auth.example.com/.well-known/openid-configuration"
# issuer_url = "https://auth.example.com"   # alternative to well_known_url
# jwks_uri = "https://auth.example.com/jwks" # alternative to well_known_url

# OIDC client config — reads from [oidc] for provider fields, adds client-specific fields
[oidc_client]
client_id = "my-app"
client_secret = "secret"
scopes = "openid profile email"
redirect_url = "/auth/callback"

# Resource server config — reads from [oidc] for provider fields, adds verifier-specific fields
[oauth_resource_server]
audiences = ["api://my-app"]
required_scopes = ["entries.read"]
# well_known_url not needed here — inherited from [oidc].well_known_url at runtime
```

### Resolution priority (per field class)

Different field types have different levels of actual support:

**URL fields** (`well_known_url`, `issuer_url`, `jwks_uri`): true presence-aware fallback — local value wins, otherwise falls back from `[oidc]`, otherwise `None`

**Credential fields** (`client_id`, `client_secret`): also presence-aware — note that on the resource-server side, credentials are only injected into an `introspection` block that already exists; the block is not created automatically

**Duration fields** (`metadata_refresh_interval`, `jwks_refresh_interval`): shared via sentinel heuristic (`0` or the default value), which cannot distinguish "explicitly set to default" from "not configured" — **not** true presence-aware

### Which fields can be shared via `[oidc]`

| Field | Shareable? | Why |
|---|---|---|
| `well_known_url` | ✅ | Same provider for both client and verifier |
| `issuer_url` | ✅ | Same issuer |
| `jwks_uri` | ✅ | Same JWKS |
| `metadata_refresh_interval` | ✅ | Operational, not semantic |
| `jwks_refresh_interval` | ✅ | Operational |
| `client_id` | ⚠️ | Not provider connectivity; but often shared between oidc-client and resource-server introspection in single-provider deployments. Can be a shared default via `[oidc]`, resolved separately from `OAuthProviderRemoteConfig`. |
| `client_secret` | ⚠️ | Same as `client_id` — not provider connectivity, but commonly shared in single-provider introspection deployments. |
| `scopes` | ❌ | Client vs verifier have different scope semantics |
| `audiences` | ❌ | Verifier-specific |
| `redirect_url` | ❌ | Client-specific |
| `introspection.*` | ❌ | Verifier-specific |

**Rules by field class**:
- **URL fields** (`well_known_url`, `issuer_url`, `jwks_uri`): true presence-aware fallback ✅
- **Credential fields** (`client_id`, `client_secret`): presence-aware, resolved separately; resource-server side only injects into a pre-existing `introspection` block ⚠️
- **Duration fields** (`metadata_refresh_interval`, `jwks_refresh_interval`): shareable, but via sentinel heuristic only ⚠️
- **Local-only** (`scopes`, `audiences`, `redirect_url`, `introspection.*` behaviour flags): not shared ❌

## 3. Implementation: `backend` module

The `securitydept-token-set-context::backend` module is the unified backend product surface. It re-exports infrastructure types from lower-level crates so adopters only need a single dependency:

```rust
use securitydept_token_set_context::backend::{
    // Mode entries
    BackendOidcPureRawConfig, BackendOidcPureConfig,
    BackendOidcMediatedRawConfig, BackendOidcMediatedConfig,
    // Shared config (re-exported from oauth-provider)
    OidcSharedConfig,
    // Infrastructure types (re-exported)
    OidcClient, OidcClientConfig, OAuthResourceServerConfig,
    OAuthResourceServerVerifier, OAuthProviderRuntime,
    BackendConfigError,
};
```

Both mode entries follow the same `resolve_config()` pattern:

```rust
// backend-oidc-pure: OidcClient + ResourceServer
impl<PC> BackendOidcPureRawConfig<PC> {
    pub fn resolve_config(self, shared: &OidcSharedConfig)
        -> Result<BackendOidcPureConfig<PC>, BackendConfigError>;
}

// backend-oidc-mediated: OidcClient + ResourceServer + MediatedContext
impl<PC, MC> BackendOidcMediatedRawConfig<PC, MC> {
    pub fn resolve_config(self, shared: &OidcSharedConfig)
        -> Result<BackendOidcMediatedConfig<PC, MC>, BackendConfigError>;
}
```

**Known limitation**: Duration fields (`metadata_refresh_interval`, `jwks_refresh_interval`) still use sentinel heuristics. A future iteration should migrate to `Option<Duration>`.

### 3.1 Recommended loading path

All backend modes enter through `securitydept_token_set_context::backend`:

**`backend-oidc-pure`**:

```rust
use securitydept_token_set_context::backend::{
    BackendOidcPureRawConfig, OidcSharedConfig,
};

let shared: OidcSharedConfig = /* from [oidc] */;
let raw: BackendOidcPureRawConfig<PC> = /* from config */;
let config = raw.resolve_config(&shared)?;
// config.oidc_client + config.oauth_resource_server ready for runtime
```

**`backend-oidc-mediated`**:

```rust
use securitydept_token_set_context::backend::{
    BackendOidcMediatedRawConfig, OidcSharedConfig,
};

let shared: OidcSharedConfig = /* from [oidc] */;
let raw: BackendOidcMediatedRawConfig<PC, MC> = /* from config */;
let config = raw.resolve_config(&shared)?;
// config.oidc_client + config.oauth_resource_server + config.mediated_context
```

| Mode | Entry | Status |
|---|---|---|
| `backend-oidc-pure` | `backend::BackendOidcPureRawConfig::resolve_config()` | ✅ ready |
| `backend-oidc-mediated` | `backend::BackendOidcMediatedRawConfig::resolve_config()` | ✅ ready |

Lower-level crate APIs (`apply_shared_defaults()`, individual `resolve_config()`) remain available for advanced use cases.

## 4. `frontend-oidc` backend role

In `frontend-oidc` mode, the backend does NOT run OIDC redirect/callback/token-exchange flows itself. Instead it:

1. Reads OIDC provider config (from `[oidc]` or `[oidc_client]`)
2. Returns a config rules response to the frontend:
   ```json
   {
     "issuer": "https://auth.example.com",
     "client_id": "my-spa",
     "scopes": ["openid", "profile", "email"],
     "redirect_uri": "https://app.example.com/callback"
   }
   ```
3. The frontend uses this to drive `createOidcClient()` from the TS SDK `/oidc` subpath

This separation keeps the backend as a config authority without duplicating the OIDC flow.

## 5. `backend-oidc-mediated` — what was called "token-set"

`securitydept-token-set-context` is the unified backend product surface. Through its `backend` module, it provides entries for **both** `backend-oidc-pure` and `backend-oidc-mediated`. The mediated mode's distinctive features:

- **Sealed refresh material**: Refresh tokens encrypted at rest via AEAD
- **Metadata redemption**: Short-lived redemption IDs for claim/source metadata
- **Post-auth redirect rules**: Server-controlled redirect URI resolution
- **Token propagation**: Authorized header injection for downstream service calls

The name "token-set" describes the *data structure* (a set of tokens), not the *mode of operation*. The new mode name `backend-oidc-mediated` better expresses what makes this mode distinct: the backend mediates all provider interaction, with the frontend only ever receiving processed tokens via redirect fragments.

[English](../en/008-OIDC-MODE-FAMILY.md) | [中文](008-OIDC-MODE-FAMILY.md)
