# Basic Auth Zone Mode

Basic Auth zone mode is the smallest auth-context mode SecurityDept should support.

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

Basic auth zone mode should not depend on OIDC.

It should mainly compose:

- `securitydept-creds`
- `securitydept-creds-manage`
- optional server and TS helpers

## Planned SDK Scope

A future lightweight TypeScript SDK for this mode only needs to help with:

- redirecting to the challenge URL
- optional logout helper behavior

Users should also be able to implement this themselves without depending on a large frontend runtime.

---

[English Version](004-BASIC_AUTH_ZONE.md) | [中文版本](004-BASIC_AUTH_ZONE_zh.md)
