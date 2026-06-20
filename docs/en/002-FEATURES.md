# Capability Matrix

This page states the currently implemented product baseline. It is not a promise that every reference-app route is a stable SDK API.

| Area | Current baseline | Primary surface |
| --- | --- | --- |
| Credential verification | Basic credentials, static tokens, JWT/JWE, and RFC 9068 access-token validation. | `securitydept-creds` |
| Credential management | Local credential/token data, atomic updates, debounced reloads, and self-write detection. | `securitydept-creds-manage` |
| OIDC/OAuth | Authorization-code/PKCE, callback exchange, refresh, user-info and claims normalization, provider and resource-server contracts. | `securitydept-oidc-client`, `securitydept-oauth-*` |
| Basic Auth context | Zone policy, challenge/login/logout metadata, redirect policy, and client adapters. | `securitydept-basic-auth-context`, `@securitydept/basic-auth-context-client*` |
| Session context | Server-owned OIDC/dev session flow, normalized session principal, and client adapters. | `securitydept-session-context`, `@securitydept/session-context-client*` |
| Token-set context | Frontend/backend OIDC modes, orchestration, registry, access-token substrate, and framework adapters. | `securitydept-token-set-context`, `@securitydept/token-set-context-client*` |
| Client foundation | Explicit environment, signals/resources, event streams, cancellation, spans, tracing, transport, storage, router/popup abstractions, and RxJS interop. | `@securitydept/client` |
| Client-IP policy | Rule-driven trusted-hop graphs for forwarded headers, bridge proofs, PROXY protocol, and local/container/Kubernetes nodes. | `securitydept-realip` |
| Reference runtime | Axum server, React WebUI, Docker runtime artifact, and end-to-end proof paths. | `apps/server`, `apps/webui` |

## Reference Server Routes

The reference server mounts these contract families:

- `/auth/session/*` for session login, callback, logout, and user info.
- `/auth/token-set/backend-mode/*` for backend OIDC login, callback, refresh, metadata redemption, and user info.
- `/api/auth/token-set/frontend-mode/config` for safe frontend OIDC configuration projection.
- `/basic/*` and `/basic/api/*` for Basic Auth challenge and protected management APIs.
- `/api/*` for dashboard-authenticated management APIs.
- `/api/propagation/*` only when bearer propagation is configured.
- `/health` and `/api/health` for health checks.

## Deliberate Boundaries

The current baseline does not productize:

- mixed-custody token ownership or a general BFF/server-side token-set model
- a built-in chooser UI, business route table, or application copy
- non-TypeScript client SDKs
- a full OpenTelemetry exporter/product observability stack
- general-purpose token exchange beyond the configured propagation forwarder

See [Roadmap](100-ROADMAP.md) for active work and explicit deferrals.

---

[English](002-FEATURES.md) | [中文](../zh/002-FEATURES.md)
