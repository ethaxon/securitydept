# Roadmap

This roadmap is aligned with the current project goal: turn SecurityDept into a mesh-oriented authentication and authorization toolkit, with `apps/server` acting as the proving ground.

## Phase 1: Low-Level Verification and Provider Layers

1. Finish and harden low-level creds verification
   - Basic Auth
   - static token
   - RFC 9068
   - JWT and JWE helpers
2. Finish and harden shared provider runtime
   - discovery refresh
   - JWKS refresh
   - introspection reuse
   - strict metadata parsing behavior

Status:

- mostly implemented

## Phase 2: Token Acquisition and Verification Layers

3. Harden `securitydept-oidc-client`
   - callback flow
   - refresh
   - claims normalization
   - reusable interfaces for downstream auth-context modes
4. Harden `securitydept-oauth-resource-server`
   - JWT/JWE/opaque verification
   - policy configuration
   - shared provider reuse
   - explicit principal extraction

Status:

- largely implemented

## Phase 3: Auth Context Modes

5. Implement basic auth zone mode
   - backend routing helpers
   - documented flow
   - small optional TS helper
6. Implement cookie-session mode
   - reusable backend auth-context extraction
   - normalized principal shape
   - optional redirect helper SDK
7. Implement stateless token-set mode
   - `id_token + access_token + sealed_refresh_token`
   - frontend token lifecycle rules
   - multi-provider token management
   - bearer propagation policy for same-resource forwarding
   - optional future token-exchange hook

Status:

- basic auth zone: documented, not fully productized
- cookie-session: reference implementation exists, reusable extraction pending
- stateless token-set mode: planned

## Phase 4: Frontend SDKs

8. Provide lightweight TypeScript SDKs
   - basic auth zone redirect helper
   - cookie-session redirect helper
   - stateless token-set SDK for token storage, header injection, background refresh, and login redirects

Status:

- planned

## Phase 5: Local Credential Operations

9. Continue evolving `securitydept-creds-manage`
   - simple Basic Auth and static token management
   - operational support for scenarios such as Docker registry login management

Status:

- implemented and already useful

## Phase 6: Reference App Validation

10. Keep `apps/server` as the proving ground for combined scenarios
    - low-level verification primitives
    - basic auth zone mode
    - cookie-session mode
    - stateless token-set mode
    - creds-manage integration

Current real-world role:

- validation environment
- auth entry point for private Docker registry mirror scenarios

## Cross-Cutting Priorities

- define a shared authenticated-principal abstraction
- keep `oidc-client` and `oauth-resource-server` separate
- keep auth-context modes above those lower layers
- document bearer forwarding boundaries clearly
- add more integration tests around the reference app as new modes land

---

[English Version](100-ROADMAP.md) | [中文版本](100-ROADMAP_zh.md)
