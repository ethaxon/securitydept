# Auth Context and Modes

This document defines the product meanings of auth context, zone, and mode in SecurityDept. For package maps and public SDK subpaths, use [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md). For release planning and deferrals, use [100-ROADMAP.md](100-ROADMAP.md).

## Core Terms

### Auth Context

An auth context is a top-level application-facing authentication integration surface. It defines where auth state lives, how frontend and backend responsibilities are split, how redirects and persistence work, and what principal shape the application receives.

SecurityDept currently has three auth contexts:

- `basic-auth-context`
- `session-context`
- `token-set-context`

### Zone

A zone exists only inside `basic-auth-context`. It defines a Basic Auth challenge boundary: route area, login/logout behavior, post-auth redirect policy, and optional real-IP access restrictions.

A zone is not a separate auth context.

### Mode

A mode exists only inside `token-set-context`. It describes the OIDC integration shape for token-set auth state.

Current token-set modes:

- `frontend-oidc`
- `backend-oidc`

`backend-oidc` presets such as `pure` and `mediated` are profiles inside `backend-oidc`, not first-level modes.

## Auth Context Overview

| Auth Context | Best For | State Ownership | Internal Shape | Main Surfaces |
| --- | --- | --- | --- | --- |
| Basic Auth context | browser-native Basic Auth and simple admin zones | browser credential cache and challenge routes | zones | `securitydept-basic-auth-context`, `@securitydept/basic-auth-context-client*` |
| Session context | centralized services and weak frontend capability | backend session store and HTTP-only cookie | no mode family | `securitydept-session-context`, `@securitydept/session-context-client*` |
| Token-set context | distributed SPAs and stronger frontend capability | determined by frontend/backend OIDC mode | `frontend-oidc`, `backend-oidc` | `securitydept-token-set-context`, `@securitydept/token-set-context-client*` |

## Basic Auth Context

`basic-auth-context` composes:

- `securitydept-creds`
- optional `securitydept-creds-manage`
- optional `securitydept-realip`
- Basic Auth challenge/login/logout response metadata
- thin browser / React / Angular helpers

Recommended browser UX:

- ordinary JSON APIs should return `401` without `WWW-Authenticate`
- a dedicated challenge route should return `401` with `WWW-Authenticate: Basic`
- a successful challenge redirects back to the application

Logout must respect browser limitations: there is no standard JavaScript API to clear cached Basic Auth credentials. SecurityDept supports protocol-compatible logout poisoning rather than pretending Basic Auth has a normal token-clear operation.

## Session Context

`session-context` is the backend-owned cookie-session auth context. It composes:

- `securitydept-oidc-client`
- `securitydept-session-context`
- `tower-sessions`
- optional browser / React / Angular helpers

The backend owns OIDC login, callback handling, session state, logout, and normalized user-info. The browser carries an HTTP-only session cookie and uses the client helper mainly for login URL, user-info, and logout entrypoints.

Session context has no mode family.

## Token-Set Context

`token-set-context` spans frontend token runtime, backend OIDC runtime, access-token substrate, and cross-boundary transport contracts.

### Frontend OIDC Mode

In `frontend-oidc`:

- the browser runs authorization, callback, token exchange, and token storage
- the backend projects safe frontend configuration through a config endpoint
- access-token material can be consumed by API calls and propagation-aware server boundaries

Rust still owns formal config projection and integration contracts even though the browser runs the OIDC flow.

### Backend OIDC Mode

In `backend-oidc`:

- the backend runs OIDC authorize, callback, refresh, exchange, and user-info paths
- the browser receives mode-qualified responses and token-set state
- `pure` and `mediated` are preset bundles inside one backend mode

Backend OIDC capability axes:

- `refresh_material_protection`: for example `passthrough` or `sealed`
- `metadata_delivery`: for example `none` or `redemption`
- `post_auth_redirect_policy`: for example `caller_validated` or `resolved`

Token propagation is not a backend-oidc axis. It belongs to `access_token_substrate`.

## Principal Boundaries

SecurityDept separates:

- `AuthenticatedPrincipal`: the human authenticated identity used by session and token-set user-info surfaces.
- `ResourceTokenPrincipal`: access-token-derived resource facts used by resource-server verification, API authorization, and propagation.

Do not treat these two as aliases. A human principal answers "who is signed in"; a resource token principal answers "what this bearer token is allowed to access."

## Redirect Boundary

Post-auth redirects are never raw unchecked URLs. Each context must keep redirect targets constrained to validated same-origin or configured application paths.

Current relevant paths:

- session callback: `/auth/session/callback`
- token-set backend-mode callback: `/auth/token-set/backend-mode/callback`
- frontend-mode config projection: `/api/auth/token-set/frontend-mode/config`
- frontend-mode browser callback route: owned by the host application / adapter integration

## Ownership Rules

- Basic Auth `zone` belongs only to `basic-auth-context`.
- `mode` belongs only to `token-set-context`.
- Session context is not a token-set mode.
- Route-facing services live in their owning crates, not in a shared auth-runtime aggregation layer.
- App-specific chooser UI, product copy, and business routes belong to adopters or reference apps, not to SDK core.

---

[English](020-AUTH_CONTEXT_AND_MODES.md) | [中文](../zh/020-AUTH_CONTEXT_AND_MODES.md)
