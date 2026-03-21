# Error System Design

This document describes the current error handling shape in SecurityDept, the security problem in that shape, and the recommended future direction.

The main design goal is simple:

- keep rich internal diagnostics for logs and operations
- return safe but useful messages to end users
- avoid collapsing everything into vague `Authentication failed`

## Current State

Today the codebase already has two useful layers:

1. `snafu` enums model domain-specific error variants
2. `ToHttpStatus` maps those variants to HTTP status codes

Examples:

- `packages/oidc-client/src/error.rs`
- `packages/oauth-resource-server/src/error.rs`
- `packages/creds-manage/src/error.rs`
- `packages/token-set-context/src/context.rs`
- `packages/auth-runtime/src/error.rs`
- `apps/server/src/error.rs`

The current reference server then turns the error into JSON by returning:

- `status` from `ToHttpStatus`
- `error` from `ToErrorPresentation`

That is convenient, but it couples two different concerns:

- internal diagnostic text
- user-facing response text

For authentication flows this is often unsafe. Raw error strings may include:

- provider-side failure details
- exact configuration mistakes
- token or callback processing context
- storage or sealing failure details

Those details are useful in logs, but they should not automatically reach the browser or CLI user.

## Problem Statement

The project needs a third layer in addition to `snafu` and `ToHttpStatus`:

- user-facing error presentation

This layer should answer:

- what message should the user see?
- how specific should that message be?
- what stable machine code should the frontend receive?

It should not reuse `Display` as the public message contract.

## Design Goals

- Preserve full internal context for logs and debugging.
- Keep HTTP status mapping separate from presentation.
- Allow variant-specific safe messages for auth flows.
- Allow optional per-instance overrides when some context is safe to expose.
- Give frontends a stable error `code` instead of forcing message parsing.
- Make it easy to audit which variants disclose specific user-visible reasons.

## Recommended Model

Keep the current `snafu` enums as the internal source of truth.

Add a separate presentation trait, for example:

```rust
use std::borrow::Cow;

pub struct ErrorPresentation {
    pub code: &'static str,
    pub message: Cow<'static, str>,
    pub recovery: UserRecovery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserRecovery {
    None,
    Retry,
    RestartFlow,
    Reauthenticate,
    ContactSupport,
}

pub trait ToErrorPresentation {
    fn to_error_presentation(&self) -> ErrorPresentation;
}
```

Then each public-facing error type implements three independent concerns:

- `Display`: internal diagnostic text
- `ToHttpStatus`: HTTP semantics
- `ToErrorPresentation`: safe public response

That separation is the core change.

`UserRecovery` is the preferred extra metadata because it tells the caller what action is appropriate next.

For the current project complexity, this is more useful than fields such as:

- `severity`
- `retryable: bool`
- `reauth_required: bool`

Those flags are either too presentation-specific or too coarse once auth flows become more complex.

## Why `UserRecovery` Is Better Than Boolean Flags

Two booleans look simple, but they quickly create ambiguous combinations:

- `retryable = true`, `reauth_required = true`
- `retryable = false`, `reauth_required = false`

The frontend still has to guess what to do.

A single recovery enum is more explicit:

- `Retry`
- `RestartFlow`
- `Reauthenticate`
- `ContactSupport`

This also keeps the server contract closer to user intent and farther from UI styling concerns.

## Why `severity` Is Not Recommended Yet

A `severity` field is usually not the most important signal in auth flows.

In practice:

- most failures are still operationally errors
- frontend styling can derive from `code` and `recovery`
- severity often becomes unstable and subjective across products

For that reason, `severity` should only be added later if multiple clients actually need a shared visual-priority contract.

## Why `DisclosureLevel` Is Not Recommended Yet

A separate disclosure model only becomes necessary when the project must support multiple public audiences with different visibility levels, for example:

- anonymous end user
- signed-in end user
- tenant admin
- system operator

SecurityDept does not need that extra abstraction yet.

For now, two sinks are enough:

- internal logs with full error detail
- client responses with sanitized presentation

That boundary can be modeled without a dedicated `DisclosureLevel`.

## Why Variant-Level Public Messages Matter

A generic message such as `Authentication failed` is often too weak for real UX.

Some auth failures should be disclosed in a specific but sanitized way:

- invalid login redirect URL
- authorization code expired
- authorization code already used
- login request expired
- CSRF or state validation failed

Those cases let the user recover by retrying or contacting an operator with a clear symptom.

Other failures should stay generic:

- upstream metadata fetch failed
- HTTP client transport errors
- token sealing failures
- filesystem or database failures
- unexpected provider response bodies

Those are operational details, not end-user actions.

## Recommended Variant Strategy

There are two useful patterns.

### Pattern A: Fixed Public Message per Variant

For many variants, a fixed safe message is enough:

```rust
impl ToErrorPresentation for OidcError {
    fn to_error_presentation(&self) -> ErrorPresentation {
        match self {
            OidcError::RedirectUrl { .. } => ErrorPresentation {
                code: "oidc_redirect_url_invalid",
                message: "The login redirect URL is invalid.".into(),
                recovery: UserRecovery::ContactSupport,
            },
            OidcError::Metadata { .. }
            | OidcError::TokenExchange { .. }
            | OidcError::TokenRefresh { .. } => ErrorPresentation {
                code: "oidc_temporarily_unavailable",
                message: "Authentication is temporarily unavailable.".into(),
                recovery: UserRecovery::Retry,
            },
            OidcError::CSRFValidation { .. } => ErrorPresentation {
                code: "oidc_request_invalid",
                message: "The sign-in request is no longer valid. Start again.".into(),
                recovery: UserRecovery::RestartFlow,
            },
            _ => ErrorPresentation {
                code: "internal_error",
                message: "Request failed.".into(),
                recovery: UserRecovery::ContactSupport,
            },
        }
    }
}
```

This is the default pattern and should cover most cases.

### Pattern B: Optional Public Override per Instance

Some variants need different safe messages depending on the exact reason.

Example: `PendingOauth` should not expose raw storage errors, but it may safely tell the user whether the login request is missing, expired, or already consumed.

That should be modeled as structured reason data, not by parsing `source.to_string()`.

```rust
use std::borrow::Cow;

pub enum PendingOauthReason {
    Missing,
    Expired,
    AlreadyUsed,
}

#[derive(Debug, Snafu)]
pub enum OidcError {
    #[snafu(display("OIDC pending OAuth error: {source}"))]
    PendingOauth {
        source: Box<dyn std::error::Error + Send + Sync>,
        reason: Option<PendingOauthReason>,
        public_message: Option<Cow<'static, str>>,
    },
}
```

Then presentation can prefer:

1. an explicit safe `public_message`
2. a structured `reason`
3. a generic fallback

This gives callers a controlled override mechanism without weakening the default policy.

## Important Rule

Do not derive public messages from:

- `source.to_string()`
- provider response bodies
- HTTP transport errors
- arbitrary lower-layer strings

If a lower layer has a user-meaningful condition, promote it into a typed variant or a typed reason enum first.

## Suggested Auth Error Disclosure Policy

Recommended categories for SecurityDept:

| Category | End-user message style | Examples |
| --- | --- | --- |
| Safe and specific | Explain the recoverable problem | invalid redirect URL, login request expired, authorization code already used |
| Safe but generic | Keep context broad | session expired, authentication required, access denied |
| Internal only | Never expose raw detail | metadata fetch errors, introspection transport failures, storage errors, crypto/sealing failures |

In practice, `redirect URL error` and `code invalid/expired` belong in the first category, but the public message should still be normalized and sanitized.

## Response Metadata

The public response should expose recovery intent directly.

Example:

- `RestartFlow` for expired or reused login requests
- `Reauthenticate` for missing session or expired login state
- `Retry` for transient operational failures
- `ContactSupport` for configuration or policy problems the user cannot fix

This is more actionable than a generic severity level.

## Response Shape

A future API response should prefer structured error payloads over a single `error` string:

```json
{
  "success": false,
  "status": 401,
  "error": {
    "code": "oidc_request_expired",
    "message": "The sign-in request expired. Start again.",
    "recovery": "restart_flow"
  }
}
```

Benefits:

- frontend logic can branch on `code`
- message text can evolve without breaking clients
- logs keep full internal detail separately

If the current response shape must be preserved for compatibility, the project can temporarily add:

- `error.code`
- `error.message`

or flatten to:

- `error_code`
- `error_message`

The key point is to stop using `Display` as the public contract.

## Logging Guidance

When returning a sanitized user response, the server should still log the full internal error chain.

Recommended behavior at the boundary:

1. log the internal error with `tracing`
2. map it to `status`
3. map it to a sanitized presentation
4. return only the sanitized presentation to the client

That keeps operations effective without leaking internals.

## Future Direction

As the project grows into multiple auth-context modes, the error system should also become mode-aware.

Examples:

- basic-auth zone mode may need browser-safe challenge and logout messages
- cookie-session mode may need session-expired vs login-required distinctions
- stateless token-set mode may need token-refresh-expired vs access-token-invalid distinctions

The same three-layer rule should still hold:

- internal error semantics
- transport/status semantics
- user-facing presentation semantics

That model scales better than trying to encode everything into one `Display` string.

It is also enough for the current stage of the project. SecurityDept should keep those three concerns separated conceptually, but it does not need three parallel error enum hierarchies for protocol, domain, and presentation right now. Domain errors plus boundary mapping traits are sufficient.

## Implementation Status

The error system described in this document has been fully implemented.

### Completed

- `packages/utils/src/error.rs` - Shared `ErrorPresentation`, `UserRecovery`, and `ToErrorPresentation` trait
- `packages/oidc-client/src/error.rs` - `ToErrorPresentation` impl for `OidcError`
- `packages/oauth-resource-server/src/error.rs` - `ToErrorPresentation` impl for `OAuthResourceServerError`
- `packages/creds/src/error.rs` - `ToErrorPresentation` impl for `CredsError`
- `packages/creds-manage/src/error.rs` - `ToErrorPresentation` impl for `CredsManageError`
- `packages/session-context/src/lib.rs` - `ToErrorPresentation` impl for `SessionContextError`
- `packages/token-set-context/src/context.rs` - `ToErrorPresentation` impl for `TokenSetContextError`
- `packages/auth-runtime/src/error.rs` - `ToErrorPresentation` impl for `AuthRuntimeError`
- `apps/server/src/error.rs` - `ToErrorPresentation` impl for `ServerError` and `IntoResponse` using the three-layer model

### Response Shape

The server now returns structured error responses:

```json
{
  "error": {
    "code": "oidc_request_expired",
    "message": "The sign-in request expired or was already used. Start again.",
    "recovery": "restart_flow"
  },
  "status": 401,
  "success": false
}
```

### Migration Path (Historical)

SecurityDept adopted this incrementally.

### Step 1

Add a small shared presentation type and trait in a common crate.

Possible location:

- `packages/utils`
- or a future dedicated error crate if cross-cutting concerns grow

**Status: DONE**

### Step 2

Implement the trait for top-level public error types first:

- `OidcError`
- `OAuthResourceServerError`
- `CredsManageError`
- `TokenSetContextError`
- `AuthRuntimeError`
- `ServerError`
- `SessionContextError`

**Status: DONE**

### Step 3

Update `apps/server/src/error.rs` so `IntoResponse` uses:

- `to_http_status()`
- `to_error_presentation()`

instead of `self.to_string()`.

**Status: DONE**

### Step 4

Refine auth-sensitive variants by introducing typed reason enums where needed, especially for:

- pending OAuth state lookup
- authorization code exchange failures
- redirect target validation

**Status: PENDING** - The current implementation uses fixed messages per variant (Pattern A). Pattern B with typed reason enums can be added when needed.

---

[English](005-ERROR_SYSTEM_DESIGN.md) | [中文](../zh/005-ERROR_SYSTEM_DESIGN.md)
