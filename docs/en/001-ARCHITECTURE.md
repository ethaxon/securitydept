# Architecture

This document describes the intended layered architecture after the recent provider, OIDC client, and resource-server split.

## Layer 1: Verification Primitives

Crate: `securitydept-creds`

Responsibilities:

- Basic Auth parsing and verification
- static token parsing and verification
- JWT verification helpers
- JWE decryption helpers
- RFC 9068 access-token validation
- shared credential and verifier traits

This layer should not know about:

- OIDC login redirects
- OAuth authorization code flow
- browser state
- application sessions

## Layer 2: Remote Provider Runtime

Crate: `securitydept-oauth-provider`

Responsibilities:

- OIDC discovery metadata fetch and refresh
- remote JWKS fetch and refresh
- shared HTTP client and connection reuse
- introspection endpoint access
- provider config normalization

This layer is shared by both the OIDC client and the resource-server verifier.

## Layer 3: OIDC Client

Crate: `securitydept-oidc-client`

Responsibilities:

- authorization code flow
- PKCE support
- callback exchange
- refresh flow
- claims normalization and optional claims script
- userinfo fetch when configured

This crate acquires identity and token material. It does not verify bearer tokens presented to arbitrary APIs.

## Layer 4: OAuth Resource Server

Crate: `securitydept-oauth-resource-server`

Responsibilities:

- verify bearer access tokens presented to APIs
- support JWT, JWE, and opaque token introspection
- apply issuer, audience, scope, and time validation policy
- manage local JWE decryption keys and key rotation watcher

This crate validates bearer tokens. It does not perform browser login or authorization-code redirect flows.

## Layer 5: Auth Context Modes

Planned higher-level compositions built above layers 1-4:

- basic auth zone mode
- cookie-session mode
- stateless token-set mode

These modes are deployment contracts. They should expose normalized principal data regardless of whether identity came from:

- OIDC callback results
- bearer access-token verification
- local basic-auth credentials
- static-token credentials

Current dedicated crate:

- `securitydept-basic-auth-zone`

A future shared abstraction should likely normalize all of them into a common authenticated-principal model.

## Layer 6: Credential Management

Crate: `securitydept-creds-manage`

Responsibilities:

- manage local basic-auth credentials
- manage local static tokens
- provide storage and synchronization primitives for simple operator-managed credentials
- support scenarios such as registry login management and basic gateway auth

This crate is operational storage, not the token-verification core.

## Layer 7: Reference Applications

Apps:

- `apps/server`
- `apps/cli`
- `apps/webui`

`apps/server` should remain a proving ground for combined capabilities:

- low-level verification
- basic auth zone mode
- cookie-session mode
- stateless token-set mode
- creds-manage integration

It is not the architecture boundary for the project.

## Important Boundary Rules

- `oidc-client` must not absorb resource-server verification.
- `oauth-resource-server` must not absorb browser login flow.
- provider caching/discovery must stay below both of them.
- auth-context modes should compose lower crates instead of duplicating their logic.
- bearer-token forwarding should be modeled explicitly and should not be hidden inside login APIs.

## Mesh-Oriented Scenario Guidance

For distributed nodes inside a virtual LAN:

- a user-facing node may run OIDC client logic
- the same node may also validate or transparently forward bearer tokens
- internal nodes may run only resource-server verification
- stateless operation means no server-side browser session store, not the absence of token semantics

Transparent forwarding is only correct when the downstream node accepts the same issuer and audience contract. If audiences differ, the future design must introduce token exchange instead of naive forwarding.

---

[English](001-ARCHITECTURE.md) | [中文](../zh/001-ARCHITECTURE.md)
