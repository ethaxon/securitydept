# Outposts External Reference Application

[Outposts](https://github.com/ethaxon/outposts) is a maintained external
reference application for SecurityDept's Angular OIDC and Rust resource-server
integration. It is useful downstream evidence, but it is not part of this
repository's source tree, release gate, public API, or reproducible test
contract.

## Current Versioned Baseline

The current released Outposts baseline is `0.4.0`. It consumes the published
SecurityDept `0.3.0-beta.6` line rather than local workspace links:

| Surface | Outposts dependency | Version |
| --- | --- | --- |
| Angular browser foundation | `@securitydept/client` | `0.3.0-beta.6` |
| Angular framework bridge | `@securitydept/client-angular` | `0.3.0-beta.6` |
| Frontend OIDC and registry | `@securitydept/token-set-context-client` | `0.3.0-beta.6` |
| Angular OIDC adapters | `@securitydept/token-set-context-client-angular` | `0.3.0-beta.6` |
| Rust server entry point | `securitydept-core` | `0.3.0-beta.6` |

The Confluence backend enables the `oauth-resource-server`, `creds`, and
`token-set-context` core features. The web application uses Angular `22.1`,
Nx `23.1`, and TypeScript `6.0`; these are adopter details, not SecurityDept
toolchain requirements.

## Integration Covered by the Reference

Outposts provides concrete evidence for the following published contracts:

- `provideEnvironment(...)` composes Angular routing with the native-web
  environment. Its flattened `routerForAngularCreateOptions` supply browser
  `location`, `history`, `navigation`, and `window`, so in-app navigation is
  dispatched through Angular Router while external OIDC authorization URLs use
  native-web full-document navigation.
- `provideTokenSetClientRegistry(...)` owns the Confluence frontend OIDC
  client. Its public configuration is resolved in the order: server-injected
  realm projection, persisted browser cache, then the Confluence public config
  endpoint.
- `secureTokenSetRouteRoot(...)` protects the Angular `/confluence` route and
  `TokenSetFrontendCallbackComponent` handles `/auth/callback`.
- The registry authorization interceptor attaches Bearer tokens only to the
  configured Confluence API origin and path, excluding the public config
  endpoint that initializes the client.
- The Confluence Rust service validates access tokens as a SecurityDept OAuth
  resource server through discovery, JWKS, optional audience validation, and
  configured scopes.

This is an integration reference, not a prescribed application architecture.
In particular, Outposts' route table, config-projection host, UI components,
and Confluence API are not SDK public API.

## Using It as Downstream Evidence

When evaluating a SecurityDept release against Outposts:

1. install the published versions above, or explicitly record a packed
   candidate version;
2. record the exact package/subpath, framework version, and observed behavior;
3. turn repeated, generalizable findings into an in-repository contract test
   and focused documentation update;
4. keep the SDK boundary defined by package exports and
   `public-surface-inventory.json`.

The executable baseline for this repository remains `apps/server` plus
`apps/webui`. See [Client SDK Guide](007-CLIENT_SDK_GUIDE.md) for the supported
TypeScript boundary and [Roadmap](100-ROADMAP.md) for scope.

---

[English](021-REFERENCE-APP-OUTPOSTS.md) | [中文](../zh/021-REFERENCE-APP-OUTPOSTS.md)
