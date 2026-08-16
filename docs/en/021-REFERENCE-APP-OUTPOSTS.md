# Outposts External Reference Application

[Outposts](https://github.com/ethaxon/outposts) is a maintained external
reference application for SecurityDept's Angular OIDC and Rust resource-server
integration. It is useful downstream evidence, but it is not part of this
repository's source tree, release gate, public API, or reproducible test
contract.

## Dependency Baseline

Outposts consumes published SecurityDept packages rather than local workspace
links. Its manifests and lockfiles own the exact application, SDK, and toolchain
versions; consult the selected Outposts revision when reproducing an integration.
The npm and Rust dependencies may advance independently.

| Surface | Outposts dependency |
| --- | --- |
| Angular browser foundation | `@securitydept/client` |
| Angular framework bridge | `@securitydept/client-angular` |
| Frontend OIDC and registry | `@securitydept/token-set-context-client` |
| Angular OIDC adapters | `@securitydept/token-set-context-client-angular` |
| Rust server entry point | `securitydept-core` |

The Confluence backend enables the `oauth-resource-server`, `creds`, and
`token-set-context` core features. Angular, Nx, and TypeScript versions are
adopter details, not SecurityDept toolchain requirements.

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
  `TokenSetFrontendCallbackComponent` handles `/auth/callback`. The host callback
  wrapper navigates to `postAuthRedirectUri` after successful handling.
- Frontend OIDC configuration uses `refreshErrorPolicy: "revokeAsUnauthenticated"`,
  so confirmed refresh-token revocation allows protected-route login to resume.
- The registry authorization interceptor attaches Bearer tokens only to the
  configured Confluence API origin and path, excluding the public config
  endpoint that initializes the client.
- Root-scoped `AuthService` subscribes to the registry's non-replaying `errors`
  stream and passes the original `ClientError` to the overlay service. The
  registry aggregates client operation and factory/materialization errors;
  subscribing does not initialize lazy clients.
- The overlay service uses `readErrorPresentationDescriptor()` for the final
  Sonner projection, including span-backed client and operation context without
  exposing tracing-only attributes or runtime diagnostics.
- The Confluence Rust service validates access tokens as a SecurityDept OAuth
  resource server through discovery, JWKS, optional audience validation, and
  configured scopes.

Outposts also pins Rust in its root `rust-toolchain.toml`; mise and the Linux
amd64/arm64 GitHub build consume that same authority instead of installing a
separate moving nightly toolchain.

This is an integration reference, not a prescribed application architecture.
In particular, Outposts' route table, config-projection host, UI components,
and Confluence API are not SDK public API.

## Using It as Downstream Evidence

When evaluating a SecurityDept release against Outposts:

1. record the Outposts revision and installed SDK versions from its manifests
   and lockfiles, or explicitly record a packed candidate version;
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
