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
   - thin client helper for zone-aware `401 -> login` redirect and logout URL handling
6. Implement cookie-session mode
   - reusable backend auth-context extraction
   - normalized principal shape
   - optional redirect helper SDK
7. Implement stateless token-set mode
   - token snapshot / delta plus metadata snapshot / delta
   - frontend token lifecycle rules
   - multi-provider token management
   - bearer propagation policy for same-resource forwarding
   - optional future token-exchange hook

Status:

- basic auth zone: documented, not fully productized
- cookie-session: reference implementation exists; the reusable core already lives in `securitydept-session-context`; route-facing services (`SessionAuthServiceTrait` / `OidcSessionAuthService` / `DevSessionAuthService`) are now directly in that crate via the `service` feature
- stateless token-set mode: the core server and shared crate are in place; `securitydept-auth-runtime` has been dissolved; mode-specific and substrate-specific services are now in `securitydept-token-set-context`; `frontend-oidc` now has formal config projection and integration contracts (`FrontendOidcModeConfigProjection` + `FrontendOidcModeIntegrationRequirement`); OIDC protocol-level principal extraction shared across presets is in `securitydept-oidc-client::auth_state`; current code still keeps `backend-oidc-pure` / `backend-oidc-mediated` as preset-specific module families, but the next mainline is a unified `backend-oidc` capability framework with preset/profile validation; mixed-custody / BFF / server-side token-set remain later-scope topics

## Phase 4: Frontend SDKs

8. Provide lightweight TypeScript SDKs
   - basic auth zone helper for zone boundary detection, `401 -> login` redirection, and logout redirects
   - cookie-session redirect helper
   - stateless token-set SDK for token storage, header injection, background refresh, and login redirects

Status:

- the TypeScript SDK is no longer only an architecture draft; the foundation packages, auth-context roots, `./web` adapters, React adapters, and reference-app dogfooding baseline are now implemented
- the repository now already has external-consumer scenarios, a token-set web focused lifecycle baseline, and a minimal React adapter focused test
- the current phase is no longer “start implementing the SDK”; it is contract freeze for `stable / provisional / experimental`, token-set v1 scope clarification, and clearer adopter-facing status
- mixed-custody, stateful BFF, server-side token-set, and heavier OTel / DI themes remain later-stage topics rather than the current frontend SDK track

Reference:

- [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md)

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
- integration proving ground for cookie-session, basic-auth, and stateless token-set flows

## Cross-Cutting Priorities

- define a shared authenticated-principal abstraction
- keep `oidc-client` and `oauth-resource-server` separate
- keep auth-context modes above those lower layers
- document bearer forwarding boundaries clearly
- add more integration tests around the reference app as new modes land

---

[English](100-ROADMAP.md) | [中文](../zh/100-ROADMAP.md)
