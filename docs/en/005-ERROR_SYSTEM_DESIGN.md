# Error System Design

SecurityDept separates internal diagnostics from public error presentation. The goal is to keep logs useful without leaking provider, token, storage, or configuration details to browser and API consumers.

Structured diagnosis is a separate contract from public error presentation. Secret-safe machine-readable auth-flow diagnosis belongs to `securitydept-utils::observability` and should be emitted for operators without being collapsed into adopter-facing error copy.

## Current Model

The current model has three independent layers:

- Internal error enums, usually implemented with `snafu`.
- HTTP status mapping through `ToHttpStatus` or route/service status helpers.
- Safe public presentation through `ToErrorPresentation`.

Shared types live in `securitydept-utils`:

- `ErrorPresentation`
- `UserRecovery`
- `ServerErrorKind`
- `ServerErrorDescriptor`
- `ServerErrorEnvelope`
- `ToErrorPresentation`

Related diagnosis vocabulary lives separately in `securitydept-utils::observability`, including `AuthFlowDiagnosis`, `DiagnosedResult`, shared `AuthFlowOperation` names such as `projection.config_fetch`, `oidc.callback`, `oidc.token_refresh`, `propagation.forward`, and `forward_auth.check`, plus newer server operations such as `dashboard_auth.check` and `creds_manage.group.*` / `creds_manage.entry.*`.

Server responses rendered through the shared envelope use this shape:

```json
{
  "success": false,
  "status": 401,
  "error": {
    "kind": "unauthenticated",
    "code": "backend_oidc_mode.bearer_token_required",
    "message": "A bearer access token is required for this endpoint.",
    "recovery": "reauthenticate",
    "presentation": {
      "code": "backend_oidc_mode.bearer_token_required",
      "message": "A bearer access token is required for this endpoint.",
      "recovery": "reauthenticate"
    }
  }
}
```

The duplicated top-level `code` / `message` / `recovery` fields are the stable consumer convenience fields. The nested `presentation` keeps the original presentation object available to clients that already consume it.

## Public Response Rules

- Do not derive public messages from `Display`, `source.to_string()`, provider response bodies, transport errors, or arbitrary lower-layer text.
- Promote user-meaningful lower-layer conditions into typed variants or typed reason enums before exposing them.
- Public messages may be specific only when the condition is safe and actionable.
- Internal logs should include the full error chain; public responses should include sanitized code, message, and recovery.
- Structured diagnosis fields should stay machine-readable and secret-safe. Use them for logs and operator tooling; do not treat them as a shortcut for generating public browser/API copy.

## Recovery Vocabulary

`UserRecovery` is the public action hint:

- `none`: no user recovery action is implied.
- `retry`: retrying the same operation is reasonable.
- `restart_flow`: restart the current auth flow.
- `reauthenticate`: sign in again or reacquire credentials.
- `contact_support`: user action cannot resolve the issue.

This is preferred over multiple booleans such as `retryable` and `reauth_required`, because the enum avoids ambiguous combinations.

## Disclosure Policy

| Category | Public Message Style | Examples |
| --- | --- | --- |
| Safe and specific | Explain the recoverable problem | invalid redirect URL, expired login request, duplicate callback state |
| Safe but generic | Keep context broad | session expired, authentication required, access denied |
| Internal only | Never expose raw detail | metadata fetch errors, introspection transport failures, storage errors, crypto / sealing failures |

## Route Response Exceptions

Most ordinary server failures use `ServerErrorEnvelope`, but some route families intentionally do not:

- Basic Auth challenge routes must preserve `WWW-Authenticate`.
- Basic Auth logout poison responses must remain plain `401` without a fresh challenge.
- ForwardAuth challenge routes must preserve proxy protocol semantics.
- Backend-mode `metadata/redeem` not-found is a business `404`, not a shared server failure envelope.
- Propagation forwarding preserves the underlying upstream status / presentation instead of rewriting it to a route-local generic error.
- Static web UI fallback errors come from the underlying static-file service.

The mounted-route policy table in `apps/server/src/routes/policy.rs` records these boundaries so new routes cannot silently regress response shape.

## Implementation Owners

- `packages/utils/src/error.rs`: shared presentation and envelope types.
- `packages/oidc-client/src/error.rs`: OIDC public presentation.
- `packages/oauth-resource-server/src/error.rs`: resource-server presentation.
- `packages/creds/src/error.rs`: credential verification presentation.
- `packages/creds-manage/src/error.rs`: credential-management presentation.
- `packages/session-context/src/lib.rs` and `packages/session-context/src/service.rs`: session presentation.
- `packages/basic-auth-context/src/service.rs`: Basic Auth context presentation.
- `packages/token-set-context/src/**/error.rs` and service modules: token-set, substrate, propagation, and forwarder presentation.
- `apps/server/src/error.rs`: shared server envelope rendering.
- `apps/server/src/routes/policy.rs`: mounted-route response-shape policy.
- `apps/webui`: host-side presentation components and recovery links.

## Maintenance Rules

- A new public route must have an explicit response-shape classification.
- A new error variant that can reach an adopter-facing response must implement safe presentation.
- Protocol-specific routes must not be "normalized" into the shared JSON envelope if doing so breaks browser or proxy semantics.
- Tests should assert `kind`, `code`, and `recovery`; message text is useful to verify but should not be the only machine contract.

---

[English](005-ERROR_SYSTEM_DESIGN.md) | [中文](../zh/005-ERROR_SYSTEM_DESIGN.md)
