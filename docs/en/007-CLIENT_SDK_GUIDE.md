# Client SDK Guide

This document defines the formal design direction for SecurityDept client SDKs. TypeScript comes first, with Kotlin and Swift expected later under the same architectural rules.

Target readers:

- human developers implementing SDK modules
- AI agents modifying SDK code or documentation

## Goal

Client SDKs should model SecurityDept auth-context behavior for client and portable runtime use cases. They must not reuse the server-side `auth-runtime` concept, and they should not collapse all behavior into one monolithic package.

Current priority:

1. TypeScript SDK
2. Kotlin SDK
3. Swift SDK

## Top-Level Decisions

- client SDKs stay separate from server route orchestration concepts
- public packages are split by auth context or capability
- default exports remain framework-neutral
- framework adapters are exposed through subpath exports in the same package
- TypeScript packages are `ESM only`
- global polyfills are not bundled by default
- packages should be side-effect free by default; any side effect must be mounted or initialized explicitly by the user

## Terminology and Naming

Do not reuse `core` for the shared client base layer.

Reason:

- `securitydept-core` already means the Rust-side re-export aggregation crate
- using `client-core` on the client side would create conflicting meanings in the same workspace

Current terms:

- `client`: top-level user-facing aggregate entry
- `foundation`: shared client infrastructure layer, usually better as an internal/workspace term than as the main public package name
- `basic-auth-context-client`: Basic Auth zone-aware helper package
- `session-context-client`: session-mode client package
- `token-set-context-client`: token-set-mode client package

For protocol-like contracts, naming currently follows a `Trait` style to avoid confusion with future global names or standard objects.

Examples:

- `ReadableSignalTrait`
- `WritableSignalTrait`
- `ComputedSignalTrait`
- `EventStreamTrait`
- `EventSubscriptionTrait`
- `LoggerTrait`
- `CancellationTokenTrait`
- `CancellationTokenSourceTrait`

## Packaging Style

SecurityDept client SDKs should follow a TanStack-like package style:

- split public packages by auth context or capability
- keep the default surface framework-neutral
- expose framework adapters through subpath exports inside the same package
- do not create extra framework aggregate packages such as `@securitydept/react-client`

TypeScript examples:

- `@securitydept/client`
- `@securitydept/client/react`
- `@securitydept/client/web`
- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`
- `@securitydept/basic-auth-context-client`
- `@securitydept/basic-auth-context-client/react`
- `@securitydept/basic-auth-context-client/web`
- `@securitydept/session-context-client`
- `@securitydept/session-context-client/react`
- `@securitydept/token-set-context-client`
- `@securitydept/token-set-context-client/react`

For npm packages that expose React adapters:

- keep `react` and related libraries in `peerDependencies`
- mark them as optional when the base package still works without the adapter
- keep the root export free of mandatory framework dependencies

## Recommended Repository Layout

Client SDKs should live in a library workspace separate from `webui`.

Current recommended shape:

```text
sdks/
  ts/
    tsconfig.json
    packages/
      client/
      basic-auth-context-client/
      session-context-client/
      token-set-context-client/
      test-utils/
  kotlin/
    ...
  swift/
    ...
```

Current TypeScript build direction:

- `pnpm workspace`
- `tsconfig references`
- `tsc -b`
- `tsdown`

`apps/webui` should keep using Vite, but Vite should not become the primary build pipeline for SDK packages.

## Foundation Design

`foundation` is the shared design and infrastructure layer. It should not own auth-context-specific state machines.

It should own:

- state primitives
- event primitives
- transport abstractions
- persistence abstractions
- configuration layering
- scheduling and clock abstractions
- error model
- cancellation and disposal
- logging and tracing
- schema integration points

### State Primitives

State semantics should lean toward TC39 `signals`, while the public API remains a thin SDK-defined protocol layer.

Current minimal direction:

```ts
interface ReadableSignalTrait<T> {
  get(): T
  subscribe(listener: () => void): () => void
}

interface WritableSignalTrait<T> extends ReadableSignalTrait<T> {
  set(value: T): void
}

interface ComputedSignalTrait<T> extends ReadableSignalTrait<T> {}
```

Principles:

- snapshot-first
- immutable snapshots
- readonly public views by default
- state transitions owned by clients/services

### Event Primitives

Event semantics should lean toward `observable`, but the SDK must not expose one concrete library type directly.

Current minimal direction:

```ts
interface EventSubscriptionTrait {
  unsubscribe(): void
}

interface EventObserver<T> {
  next?(value: T): void
  error?(error: unknown): void
  complete?(): void
}

interface EventStreamTrait<T> {
  subscribe(observer: EventObserver<T>): EventSubscriptionTrait
}
```

The public design should keep:

- a minimal event protocol
- a minimal operator set
- structured event envelopes

### Transport

Do not model interceptors as middleware APIs tied to one HTTP client.  
Foundation should only define a neutral transport protocol.

Current direction:

```ts
interface HttpRequest {
  url: string
  method: string
  headers: Record<string, string>
  body?: unknown
}

interface HttpResponse {
  status: number
  headers: Record<string, string>
  body?: unknown
}

interface HttpTransport {
  execute(request: HttpRequest): Promise<HttpResponse>
}
```

`401`, redirect, and reauthentication handling belong to auth runtime policy, not to transport itself.

### Persistence

Persistence must not be reduced to a generic KV wrapper. It should distinguish:

- long-lived state
- recoverable state
- ephemeral flow state

Current direction:

```ts
interface RecordStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

interface Codec<T> {
  encode(value: T): string
  decode(raw: string): T
}

interface PersistentAuthStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  clear(): Promise<void>
}

interface RecoverableStateStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  clear(): Promise<void>
}

interface EphemeralFlowStore<T> {
  load(): Promise<T | null>
  save(value: T): Promise<void>
  consume(): Promise<T | null>
  clear(): Promise<void>
}
```

Suggested exports:

- `@securitydept/client/persistence`
- `@securitydept/client/persistence/web`

### Configuration

Configuration should be layered, not flattened into one large options object.

Recommended layers:

- runtime / foundation config
- auth-context config
- adapter / framework config

Example:

```ts
createTokenSetContextClient({
  runtime: {
    transport,
    persistence,
    scheduler,
    clock,
  },
  auth: {
    authorizePath,
    callbackPath,
    refreshPath,
    refreshWindowMs,
  },
})
```

Validation:

- prefer `@standard-schema`
- do not bind to one concrete validation library

### Scheduling and Unified Input Sources

This topic is not just about timers. It is about unified input sources and scheduling sources.

Foundation should likely provide:

- `fromEventPattern`
- `fromSignal`
- `timer`
- `interval`
- `scheduleAt`
- `fromPromise`

Adapter layers can then provide:

- `fromEventTarget`
- `fromStorageEvent`
- `fromVisibilityChange`
- `fromAbortSignal`

Do not rely on a single giant `setTimeout`.  
Use:

- absolute deadlines
- chunked scheduling
- lifecycle-triggered recalculation

### Internal Dependency Injection

The current direction is not to introduce a formal DI container or `injection-js`.

Preferred direction:

- explicit capability wiring
- a `runtime` bundle
- a small number of composition roots
- internal services composed through explicit `Deps` objects

If complexity truly grows later, consider a reflection-free typed-token resolver.

## Context Client Design

### `basic-auth-context-client`

This module should stay intentionally thin. Its purpose is not to replace browser-native Basic Auth, but to make zone-aware routing and redirect behavior predictable.

Minimum responsibilities:

- define the active Basic Auth zone boundary
- determine whether the current route is inside that zone
- when a protected API inside that zone returns `401`, redirect to the zone login URL
- include the current route as `post_auth_redirect_uri` or an equivalent parameter
- expose a logout helper that redirects to the configured zone logout URL

### `session-context-client`

This module is expected to stay relatively thin and mainly cover:

- login trigger helpers
- logout helpers
- `me` endpoint access
- session presence probing
- optional post-login redirect helpers

### `token-set-context-client`

This is expected to be the heaviest module. It should own:

- callback fragment parsing
- token snapshot / delta merge rules
- metadata redemption flow
- persistence adapters
- refresh scheduling
- multi-provider or multi-source management
- bearer header injection helpers
- refresh / redemption failure recovery policy

#### Mixed Custody and BFF Boundary

Mixed-custody must be recognized:

- `browser-owned token family`
- `bff-owned token family`

The same token family must not be owned concurrently by browser and BFF.  
Mixed-custody should appear in the formal design, but it must be clearly marked as:

- an important boundary
- high complexity
- not fully implemented in v1

#### Multi-OIDC-Client / Multi-Requirement Route Orchestration Boundary

Another downstream-adopter scenario must also be considered:

- a single frontend host talks to multiple backend services
- different backend services may use different OIDC clients / audiences / scope sets
- one frontend route area may require credentials for both `app1` and `app2`

The hard problem in this scenario is not only “how to get tokens”, but also:

- which requirements can be satisfied silently
- which requirements require interactive redirect
- whether multiple interactive requirements should produce a user-choice step first
- how remaining requirements resume after callback recovery

Current recommended direction:

- the SDK may eventually grow **headless orchestration primitives / scheduler direction**
- `token-set-context-client`, or a future layer above it, may own pending-requirement / callback-recovery state-machine concerns
- chooser UI, router policy, and product-facing interaction steps should remain in adopter-owned app glue

The current status should stay explicit:

- this is a high-value downstream reference-case direction
- it should inform future `token-set-context-client` design
- but it is **not part of the currently verified v1 contract**

## Server Support

Server support should not mean “a separate server-only client core”. It should still build on the same portable capability model.

### `basic-auth-context` and `session-context`

They should support redirect-aware SSR / server request handling.

The core is not browser navigation. The core is a neutral redirect instruction:

```ts
export const AuthGuardResultKind = {
  Ok: "ok",
  Redirect: "redirect",
} as const

export const AuthGuardRedirectStatus = {
  Found: 302,
  SeeOther: 303,
  TemporaryRedirect: 307,
} as const

type AuthGuardResult<T> =
  | { kind: typeof AuthGuardResultKind.Ok; value: T }
  | {
      kind: typeof AuthGuardResultKind.Redirect
      status: (typeof AuthGuardRedirectStatus)[keyof typeof AuthGuardRedirectStatus]
      location: string
    }
```

### `token-set-context`

Server-side support should be treated as a higher-level, stateful BFF mode rather than as a small SSR extension.

Principles:

- server-side `token-set-context` support is provisional
- SSR / BFF should consume `bff-owned` token families only
- for sensitive third-party tokens, avoid making the BFF hold raw access tokens whenever possible

## Error Model

The client should not rely on a flat single-layer `Error` model.  
A two-layer model is preferred:

- machine-facing runtime error
- user-facing presentation / recovery hint

Current server-aligned base contract:

```ts
export const UserRecovery = {
  None: "none",
  Retry: "retry",
  RestartFlow: "restart_flow",
  Reauthenticate: "reauthenticate",
  ContactSupport: "contact_support",
} as const

type UserRecovery = (typeof UserRecovery)[keyof typeof UserRecovery]

interface ErrorPresentation {
  code: string
  message: string
  recovery: UserRecovery
}
```

Current principles:

- preserve server-returned `error: { code, message, recovery }` when available
- `code` is the stable cross-layer contract; `message` is not
- prefer exported `const object + type alias` contracts such as `UserRecovery`, `ClientErrorKind`, `AuthGuardResultKind`, and `TokenSetBootstrapSource` over raw string unions or TypeScript `enum`
- preserve `cause` and structured context
- redirect / reauthenticate flows should not always be modeled as ordinary exceptions

## Cancellation and Disposal

Cancellation and resource disposal must be first-class core concerns.

Current direction:

```ts
interface DisposableTrait {
  dispose(): void
}

interface CancelableHandle {
  cancel(): void
}

interface CancellationTokenTrait {
  readonly isCancellationRequested: boolean
  readonly reason?: unknown
  onCancellationRequested(listener: (reason: unknown) => void): DisposableTrait
  throwIfCancellationRequested(): void
}

interface CancellationTokenSourceTrait extends DisposableTrait {
  readonly token: CancellationTokenTrait
  cancel(reason?: unknown): void
}
```

Principles:

- `CancelableHandle` is mainly for resource handles
- clients should own a root cancellation source
- `dispose()` should:
  - cancel the root source
  - clean up scheduler handles / subscriptions / watchers
  - prevent new operations from starting
- `AbortSignal` is better treated as a web interop bridge, not as the only core cancellation primitive

## Logging, Tracing, and Testing

Foundation should formally provide an observability layer:

- `LoggerTrait`
- `TraceEventSinkTrait`
- `OperationTracerTrait`

Principles:

- leave room for an OpenTelemetry bridge, but do not bind the default core to OTel directly
- timeline / trace sinks are the primary observation surface for behavior tests, not plain text logs

Testing should be layered:

1. protocol and primitive tests
2. runtime orchestration tests
3. auth client tests
4. adapter tests
5. scenario / regression tests

Preferred test utilities:

- `FakeClock`
- `FakeScheduler`
- `FakeTransport`
- `InMemoryPersistence`
- `InMemoryTraceCollector`

## Build, Compatibility, and Side Effects

### Output and Compatibility

- `ESM only`
- full type declarations
- no default CJS support
- foundation compatibility is described mainly in terms of ECMAScript / JS built-in requirements
- host-specific requirements are described through adapter capability requirements
- do not maintain a caniuse-style all-platform support table
- do describe verified environments separately

### Polyfills

- do not bundle or auto-install global polyfills by default
- do not patch `globalThis` by default
- prefer capability injection over polyfills
- where needed, prefer ponyfills or opt-in helpers

### sideEffects / Tree Shaking

- tree shaking is a design goal
- the SDK should be side-effect free by default
- any side effect must require explicit user mounting or initialization
- imports must not automatically trigger scheduling, storage restore, redirects, logging, tracing, or polyfills
- `sideEffects: false` should be the target capability, not a late packaging patch

## API Stability

Not all public exports should be treated as equally stable.  
The current design should distinguish at least:

- `stable`
- `provisional`
- `experimental`

Prefer `stable` for:

- foundation base protocols
- the main entry points and core APIs of each context client

Prefer `provisional` for:

- advanced `token-set-context` behavior
- future server adapters
- mixed-custody / BFF high-complexity strategies

Prefer `experimental` for:

- advanced event operators
- advanced DI helpers
- debug / OTel bridge helpers

Subpath exports are also public contract.

### Current 0.x Freeze Semantics

In the current 0.x TypeScript SDK stage, `stable / provisional / experimental` should be read with explicit release semantics, not as loose adjectives:

- `stable`
  - Meaning: the current public contract is ready to be depended on directly by external consumers
  - Allowed change: additive capability, backward-compatible convenience, documentation clarification, internal refactors
  - Should not happen: silent responsibility shifts between layers, entry-path churn, or changes that invalidate the documented minimal entry path
  - Current basis: the root capability boundary is clear, minimal entry paths are explainable, ordinary usage does not rely on reference-app-only glue, and there are already narrow guardrails around exports/build/public vocabulary
- `provisional`
  - Meaning: publicly usable and intentionally exported, but still managed as a freezing adapter/capability boundary rather than a settled release-grade surface
  - Allowed change: lifecycle hardening, additive convenience, more focused automation, clearer capability requirements
  - Still risky: frequent entry-shape churn, pulling app glue back into adapters, or promoting to `stable` before the evidence changes
  - Current basis: the subpaths are real and usable, but ordinary usage still depends more heavily on capability requirements, adapter-owned lifecycle boundaries, and focused evidence
- `experimental`
  - Meaning: exposed mainly for testing, demos, or exploration, not as a publishable stability promise
  - Allowed change: renaming, reshaping, replacement, or removal
  - Current basis: these surfaces primarily serve tests/demo/workbench scenarios rather than core adopter-facing integration

The important distinction is:

- `stable` answers what is already a v1-candidate external contract
- `provisional` answers what is public and usable, but still under a stricter freeze bar
- `experimental` answers what is still mainly for internal validation rather than external promise

### Current Contract Snapshot

This is the current working contract map for the TypeScript SDK. It keeps the main stability, capability, and boundary judgment in one place so later sections can reference it instead of restating it.

| Package / Subpath | Stability | Host / Capability Requirement | Current Reading |
|---|---|---|---|
| `@securitydept/client` | `stable` | No DOM, no implicit `fetch`; caller provides transport/runtime | Foundation root export |
| `@securitydept/client/persistence` | `stable` | No browser storage; in-memory stores, codecs, protocols remain foundation | Foundation persistence capability |
| `@securitydept/client/web` | `stable` ¹ | `fetch` / `AbortSignal`; browser convenience without side effects | Foundation-owned capability adapter |
| `@securitydept/client/persistence/web` | `stable` ¹ | Web-storage semantics; inject custom store if unavailable | Foundation-owned storage adapter |
| `@securitydept/basic-auth-context-client` | `stable` | No React; redirect convenience stays in `./web` | Basic-auth root contract |
| `@securitydept/basic-auth-context-client/web` | `provisional` | `location` / redirect semantics | Auth-context browser adapter |
| `@securitydept/basic-auth-context-client/react` | `provisional` | React runtime | React adapter |
| `@securitydept/session-context-client` | `stable` | Transport / cancellation; login redirect flow is not SDK surface | Session root contract |
| `@securitydept/session-context-client/react` | `provisional` | React runtime | React adapter |
| `@securitydept/token-set-context-client` | `stable` ² | Callback / restore / refresh / persistence / traceSink | Browser-owned token-set v1 root contract |
| `@securitydept/token-set-context-client/web` | `provisional` | `location` / `history` / `fetch` / flow-state storage | Token-set browser adapter |
| `@securitydept/token-set-context-client/react` | `provisional` | React runtime | Token-set React adapter |
| `@securitydept/test-utils` | `experimental` | Fake clock / scheduler / transport / trace collector | Test/demo infra |

¹ Adapter subpaths default to `provisional`, but `@securitydept/client/web` and `@securitydept/client/persistence/web` are intentional `stable` exceptions because they remain foundation-owned capability adapters: narrow responsibility, no product semantics, and only wire foundation protocols to host capabilities.

² This `stable` label covers the browser-owned token-set v1 contract only. Mixed-custody / BFF / server-side token-set are not included.

Shared reading rules:

- `stable` means the current public contract is already explainable as a 0.x external contract, even though additive evolution may still happen
- `provisional` means public and usable, but still under a stricter adapter freeze bar
- `experimental` means test/demo/workbench-facing rather than adopter-facing
- automation currently locks export maps, `sideEffects: false`, and build entry alignment; stability labels themselves remain a documentation-layer judgment

#### Capability Boundary Rules

Use these rules to answer "which layer owns this capability?" without rereading the whole guide:

- **redirect / location / history** → `./web` subpaths or app glue, not foundation root exports
- **fetch / AbortSignal** → foundation transport can express cancellation; browser convenience stays in `./web`
- **persistence / web storage** → protocols & codecs are foundation; `localStorage` / `sessionStorage` adapters belong in `persistence/web`
- **React state / subscription** → `./react` subpaths only, not root exports
- **traceSink / lifecycle trace** → SDK contract
- **trace timeline UI / DOM harnesses / propagation probes / business helpers** → reference app glue, not SDK surface

### token-set-context-client v1 Scope Baseline

Read `@securitydept/token-set-context-client` as a frozen browser-owned v1 baseline, not as an umbrella for every future custody model.

| In v1 scope | Outside v1 scope |
|---|---|
| browser-owned token-set flow | mixed-custody token family management |
| callback fragment parsing + metadata redemption | stateful BFF token ownership |
| in-memory auth-state signals | server-side token-set adapters / SSR token stores |
| persisted restore + explicit clear | cross-tab sync / visibility re-check and larger browser lifecycle hardening |
| refresh-token-driven refresh | multi-provider orchestration / token-family policy |
| bearer authorization-header projection | product-specific resource helpers / propagation probes / trace timeline UI |
| transport convenience such as `createTokenSetAuthorizedTransport()` |  |
| `./web` browser bootstrap / callback fragment capture / reset helpers |  |
| minimal `./react` integration |  |

Why these topics stay out of v1:

- mixed-custody / BFF / server-side token-set materially change the ownership model rather than extend the current one
- larger browser lifecycle work belongs to later adapter hardening, not the first root-contract freeze
- app-specific helpers and probes depend on reference-app API shapes and product models, so leaving them in `apps/webui` keeps the SDK surface understandable

### Adopter Checklist

Use this section to decide quickly whether the current SDK fits your use case and where to enter it.

| If you need... | Use / Expect | Do not assume |
|---|---|---|
| browser app / SPA token-set | `@securitydept/token-set-context-client` root (`stable`), plus `./web` for browser bootstrap/callback/storage | timeline UI, propagation probes, or `apps/webui/src/api/*` are SDK surface |
| React integration | `@securitydept/*/react` for minimal Provider + hook integration; `session-context-client/react` can start directly from the React entry below | route guards, pending-redirect UI, or reference-page interaction forms are part of the adapter contract |
| token-set beyond browser-owned baseline | read it as outside v1 scope immediately | mixed-custody / BFF / SSR token store support already exists |

What must not be treated as SDK surface:

| Item | Where It Lives | Why |
|---|---|---|
| `apps/webui/src/api/*` business helpers | reference app | depends on reference-app API shapes and product models |
| trace timeline UI / DOM harnesses | reference app | debugging/demo glue, not external contract |
| propagation smoke / same-server probes | reference app + server config | depends on product routes and service config |
| SSR session redirect glue (full form) | app/server layer | framework response boundary belongs to the app |
| cross-tab sync / visibility lifecycle | outside v1 scope | future adapter hardening topic |

Before you adopt:

- your runtime has `fetch` / `AbortSignal` support for browser-facing paths
- your storage needs fit `localStorage` / `sessionStorage`, or you are ready to inject a custom store
- you understand that `./web` and `./react` subpaths are still `provisional`
- you do not expect the SDK to absorb product concerns such as route guards, login redirects, or timeline UI
- if you use React, you are ready to provide transport / scheduler / clock from the host

### Verified Environments / Host Assumptions

"Currently verified" here means capability prerequisite plus test-environment granularity, not a brand-browser matrix.

| Scope | Required Host Capability | Currently Verified | Assumed but Not Broadly Verified | Not Yet Verified / Not Promised |
|---|---|---|---|---|
| Foundation packages | ES2020+, `Promise`, `Map` / `Set` / `WeakRef` | Node.js (vitest), modern browser (Vite build) |  | IE / legacy environments, non-ES-module hosts, CJS consumers |
| Browser capability adapters | `fetch`, `AbortSignal`, `localStorage` / `sessionStorage` semantics | apps/webui dogfooding, vitest jsdom | `sessionStorage` cross-tab isolation, storage-event exact behavior | Service Worker environments, non-standard storage hosts, per-browser matrices |
| Auth-context `./web` adapters | `location.href`, `history.replaceState`, `fetch`, flow-state storage | apps/webui dogfooding, token-set browser focused lifecycle tests | SPA-router edge behavior, iframe / webview suitability | non-SPA router scenarios, SSR hosts, React Native / Electron |
| React adapters | React 18+ (`useSyncExternalStore`), host-provided transport / scheduler / clock | vitest focused adapter test(s), apps/webui dogfooding | React 17, React Server Components, concurrent-mode edge behavior | non-React hosts, React Native |

### Minimal Entry Paths

These are intentionally small “how do I start?” snippets, not replacements for the reference app.

#### 1. Foundation entry: runtime stays explicit

Use the foundation packages when the host wants to own transport/runtime wiring itself.

```ts
import { createRuntime } from "@securitydept/client";
import { SessionContextClient } from "@securitydept/session-context-client";

const runtime = createRuntime({
	transport: {
		async execute(request) {
			const response = await fetch(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});

			return {
				status: response.status,
				headers: Object.fromEntries(response.headers.entries()),
				body: await response.json().catch(() => null),
			};
		},
	},
});

const sessionClient = new SessionContextClient({
	baseUrl: "https://auth.example.com",
});

const session = await sessionClient.fetchMe(runtime.transport);
```

#### 2. Browser entry: `./web` owns browser glue

Use `./web` when the host wants browser capability helpers such as `fetch`, storage-backed flow state, and callback bootstrap.

```ts
import {
	bootstrapTokenSetClient,
	createTokenSetBrowserClient,
	resolveTokenSetAuthorizeUrl,
} from "@securitydept/token-set-context-client/web";

const client = createTokenSetBrowserClient({
	baseUrl: "https://auth.example.com",
	defaultPostAuthRedirectUri: window.location.href,
});

const bootstrap = await bootstrapTokenSetClient(client);

if (bootstrap.source === "empty") {
	window.location.href = resolveTokenSetAuthorizeUrl(client);
}
```

#### 3. React entry: `session-context-client/react` starts with Provider + hook wiring

If an adopter wants a React entry for session-context, start with `SessionContextProvider` + `useSessionPrincipal`; route guards, page-level UI, and app glue still stay with the host.

```tsx
import {
	SessionContextProvider,
	useSessionPrincipal,
} from "@securitydept/session-context-client/react";

function SessionBadge() {
	const principal = useSessionPrincipal();

	return <output>{principal?.displayName ?? "guest"}</output>;
}

export function App() {
	return (
		<SessionContextProvider
			config={{ baseUrl: "https://auth.example.com" }}
			transport={{
				async execute(request) {
					const response = await fetch(request.url, {
						method: request.method,
						headers: request.headers,
						body: request.body,
					});

					return {
						status: response.status,
						headers: Object.fromEntries(response.headers.entries()),
						body: await response.json().catch(() => null),
					};
				},
			}}
		>
			<SessionBadge />
		</SessionContextProvider>
	);
}
```

#### 4. SSR redirect entry: still app/server glue

SSR redirect handling is still an app/server concern. The SDK helps build the redirect URL, but it does not hide your framework’s response boundary.

```ts
import { SessionContextClient } from "@securitydept/session-context-client";

const sessionClient = new SessionContextClient({
	baseUrl: "https://auth.example.com",
});

export async function loader(request: Request) {
	const url = new URL(request.url);
	const returnTo = `${url.origin}${url.pathname}${url.search}`;

	return Response.redirect(sessionClient.loginUrl(returnTo), 302);
}
```

### Provisional Adapter Maintenance Standard

Auth-context `./web` and `./react` subpaths are usable but maintained under a stricter `provisional` bar than root exports. Foundation-owned stable exceptions (`@securitydept/client/web`, `@securitydept/client/persistence/web`) are explained in the [Capability Checklist](#current-public-contract-and-capability-checklist) footnote ¹.

Maintenance rules:

- keep subpath ownership stable: browser capability in `./web`, React integration in `./react`, business helpers outside the SDK
- keep import-time behavior stable: no global patching, no implicit polyfills, no side effects on import
- allow additive convenience evolution; avoid shape churn that forces consumers to relearn every iteration
- guard adapter contract with reference-app dogfooding plus focused smoke/regression tests, not prose alone
- current minimum evidence baseline: external-consumer scenarios, token-set web lifecycle tests, at least one token-set React focused test

#### Provisional Adapter Promotion Checklist

All conditions must be satisfied before re-evaluating promotion to `stable`:

| Condition | Judgment Criterion |
|---|---|
| Capability boundary is stable | No significant reshuffling across multiple iterations and reviews |
| Minimal entry path is clear | Standalone minimal example exists, not dependent on full reference-app pages |
| Ordinary usage independent of reference-app glue | Standard use case explainable without `apps/webui` product glue |
| Focused automation covers adapter lifecycle | Key export facts and main lifecycle path have focused guardrails |
| Verified environments described accurately | Host prerequisites match actual verification granularity (see [Verified Environments](#verified-environments--host-assumptions)) |

#### Current Promotion Readiness (snapshot, not roadmap)

| Adapter | Strongest Evidence | Current Gap |
|---|---|---|
| `token-set-context-client/web` | Focused lifecycle tests (covering callback precedence/recovery, retained-fragment replacement/reset-to-empty transitions, and shared-store fresh-client restore/reset), reference-app dogfooding, minimal entry example | Broader browser lifecycle hardening (cross-tab sync, etc.) |
| `token-set-context-client/react` | Minimal React focused test, entry example, StrictMode remount/disposal focused test, reconfigure dispose/subscription-isolation focused test | React 17 / concurrent mode not verified; broader host matrix still uncovered |
| `basic-auth-context-client/web` + `/react` | Redirect-contract focused root tests, zone-aware external-consumer scenario coverage, zone-aware standalone minimal entry example, query/hash-bearing browser-route forwarding focused web tests, dedicated React provider/hook focused test | Broader browser-host semantics remain unverified |
| `session-context-client/react` | Standalone minimal entry example, dedicated React provider/hook, refresh/cleanup focused test, StrictMode stale-fetch discard focused test, reconfigure stale-result discard focused test | React 17 / concurrent mode not verified; broader host matrix still uncovered |

## Examples and Reference Implementations

### Primary Real Reference Apps

- `apps/server`
- `apps/webui`

These should be treated as the first-priority dogfooding and reference applications.

The current intended reading is:

- `apps/server`: the reference server, providing real auth, forward-auth, and propagation semantics for the client SDKs
- `apps/webui`: the reference app, validating real read/write flows, auth lifecycle behavior, trace timeline usage, and minimal usable propagation dogfood
- business helpers under `apps/webui/src/api/*`: reference app glue, not SDK public surface
- `apps/webui/src/routes/tokenSet/*`: reference-page UI / observability glue, used to explain and regression-test SDK boundaries, not an SDK package
- `sdks/ts/packages/test-utils`: test/demo infrastructure, and should not be conflated with reference app glue

### Downstream Reference Case: Outposts

In addition to `apps/server` and `apps/webui`, `/workspace/outposts` should be treated as a high-value downstream adopter reference case:

- it does not replace the primary reference-app / dogfooding path
- its value is validating real multi-backend, multi-OIDC-client, route-level requirement-orchestration scenarios
- it is more useful for guiding future headless orchestration primitive / scheduler direction than for being read as a current completed capability

See the staged planning document:

- [021-REFERENCE-APP-OUTPOSTS.md](021-REFERENCE-APP-OUTPOSTS.md)

### Current Bundle / Code Split Judgment

- iteration 12 already removed the most obvious chunk warning through a local route split for `/token-set`
- because of that, bundle/code splitting can currently be downgraded from “blocking issue” to “follow-up engineering topic”
- if more work is needed later, the next reasonable split points should be other dense reference routes or shared UI hot paths, not repeated mechanical splitting of the same token-set page
- at the current stage, this topic should stay behind SDK public contract, capability requirement, and boundary hardening

### Demo and OIDC Provider

- fake/test infrastructure can be reused to build interactive demos such as timeline and trace visualizers
- if a full OIDC flow demo is needed, use a lightweight container-friendly demo provider
- Dex is the current preferred first option
- demos themselves should support Docker / `docker compose`

## Requirements for Future Developers and AI Agents

- do not rename or reframe the client SDK as `auth-runtime`
- do not let platform adapters leak back into `foundation`
- do not add global polyfills or import-time side effects by default
- do not let v1 `token-set-context-client` expand into an unconstrained monolith covering all mixed-custody / BFF complexity
- before adding abstractions, first check whether `apps/server` and `apps/webui` can serve as the real integration target

[English](007-CLIENT_SDK_GUIDE.md) | [中文](../zh/007-CLIENT_SDK_GUIDE.md)
