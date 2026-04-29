# Capability Matrix

This document summarizes current SecurityDept capabilities. Use [001-ARCHITECTURE.md](001-ARCHITECTURE.md) for ownership boundaries, [007-CLIENT_SDK_GUIDE.md](007-CLIENT_SDK_GUIDE.md) for TypeScript SDK contracts, and [100-ROADMAP.md](100-ROADMAP.md) for release planning.

## Capability Status

| Area | Current Status | Primary Surfaces |
| --- | --- | --- |
| Credential verification | Implemented for Basic Auth, static tokens, JWT, JWE, and RFC 9068 access tokens. | `securitydept-creds` |
| OIDC client | Implemented authorization-code / PKCE, callback exchange, refresh, claims normalization, optional userinfo, and pending OAuth state. | `securitydept-oidc-client` |
| OAuth resource server | Implemented bearer verification for JWT, JWE, and opaque tokens with issuer / audience / scope policy. | `securitydept-oauth-resource-server`, `securitydept-oauth-provider` |
| Basic Auth context | Implemented Basic Auth zones, challenge / login / logout metadata, post-auth redirects, optional real-IP access policy, server integration, and browser / React / Angular helpers. | `securitydept-basic-auth-context`, `@securitydept/basic-auth-context-client*` |
| Session context | Implemented cookie-session context, normalized principal, OIDC session service, dev-session service, server integration, and browser / React / Angular helpers. | `securitydept-session-context`, `@securitydept/session-context-client*` |
| Token-set context | Implemented frontend/backend OIDC mode contracts, backend-mode routes, frontend-mode config projection, access-token substrate, bearer propagation, route orchestration, React / Angular adapters, and reference-app dogfooding. | `securitydept-token-set-context`, `@securitydept/token-set-context-client*` |
| Real-IP resolution | Implemented trusted provider/source model for forwarded headers, PROXY protocol, local / remote / command / Docker / Kubernetes provider sources, and reference-server Basic Auth policy integration. | `securitydept-realip` |
| Credential management | Implemented local Basic Auth and static-token storage with lock-free reads, atomic writes, debounced watching, and self-write detection. | `securitydept-creds-manage`, `apps/cli`, `apps/server` |
| Reference apps | Implemented Axum server, React web UI, playground/reference routes, management API auth branching, bearer propagation, and Docker image build path. | `apps/server`, `apps/webui`, `Dockerfile` |
| TypeScript SDK release surface | Implemented publishable npm package families for shared client foundation, Basic Auth, session, token-set, React, and Angular integration. | `sdks/ts/packages/*`, `public-surface-inventory.json` |

## Current Auth-Context Baseline

SecurityDept currently treats these as the product auth-context surfaces:

- Basic Auth context: lightweight browser-native Basic Auth zones and helpers.
- Session context: backend-owned session state with HTTP-only cookie flow.
- Token-set context: browser / backend OIDC mode contracts with access-token substrate and framework adapters.

Token-set is intentionally richer than Basic Auth and session. Basic Auth and session should remain discoverable and tested, but they should not grow into parallel large frontend runtimes unless repeated adopter evidence proves the need.

## Reference Server Behavior

The reference server validates combined behavior through:

- `/api/*` dashboard APIs with bearer-first, session-second, Basic Auth fallback authorization.
- `/basic/*` Basic Auth dashboard zone and `/basic/api/*` Basic Auth-protected management API mirror.
- `/auth/session/*` session login, callback, logout, and user-info routes.
- `/auth/token-set/backend-mode/*` backend OIDC mode routes.
- `/api/auth/token-set/frontend-mode/config` frontend OIDC mode config projection.
- `/api/propagation/*` bearer-authenticated propagation forwarder when configured.
- route-level diagnosis and response-shape policy tables for shared envelope, protocol exceptions, business not-found, and forwarding-preserved errors.

## Known Boundaries

These topics are recognized but not part of the current stable product baseline:

- mixed-custody token ownership
- full BFF / server-side token-set ownership
- built-in chooser UI or product route tables in the SDK
- non-TypeScript SDK productization
- full OTel/exporter stack
- broad token-exchange policy beyond the current propagation forwarder baseline

---

[English](002-FEATURES.md) | [中文](../zh/002-FEATURES.md)
