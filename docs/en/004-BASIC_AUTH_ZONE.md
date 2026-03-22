# Basic Auth Context Mode

Basic Auth context mode is the smallest auth-context mode SecurityDept should support.

It is intended for deployments where browser-native Basic Auth is acceptable and a full OIDC flow would be excessive.

## UX Problem

A modern SPA cannot blindly treat all `401 Unauthorized` responses with `WWW-Authenticate: Basic` the same way. If normal API requests trigger the browser's native login dialog, the SPA loses control over the experience.

## Core Pattern

SecurityDept should isolate Basic Auth challenges behind an explicit challenge route.

Recommended behavior:

- ordinary JSON APIs return `401` without `WWW-Authenticate`
- a dedicated challenge entry route returns `401` with `WWW-Authenticate: Basic`
- when credentials are valid, that challenge route redirects back to the app

This keeps the browser-native dialog opt-in instead of accidental.

## Logout Constraint

Browsers do not expose a standard JavaScript API to clear cached Basic Auth credentials.

For that reason, a future reference implementation may still need the classic credential-poisoning logout trick:

- send deliberately invalid Basic Auth credentials to a dedicated logout endpoint
- return `401` without `WWW-Authenticate`
- let the browser replace the cached credentials silently

## Relationship to Other Layers

Basic auth context mode should not depend on OIDC.

It should mainly compose:

- `securitydept-creds`
- `securitydept-creds-manage`
- optional `securitydept-realip` access restrictions for weaker deployments
- optional server and TS helpers

## Current Config Direction

The current Rust crate is `securitydept-basic-auth-context`.

Its configuration already separates:

- global basic-auth context settings
- one or more zone definitions with their own post-auth redirect rules
- optional `real_ip_access` restrictions backed by `securitydept-realip::RealIpAccessConfig`

## Planned SDK Scope

A future lightweight TypeScript SDK for this mode only needs to help with:

- redirecting to the challenge URL
- optional logout helper behavior

Users should also be able to implement this themselves without depending on a large frontend runtime.

---

[English](004-BASIC_AUTH_ZONE.md) | [中文](../zh/004-BASIC_AUTH_ZONE.md)
