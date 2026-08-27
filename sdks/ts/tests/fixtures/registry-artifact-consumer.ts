import { inject as angularInject, type InjectionToken } from "@angular/core";
import {
	type EventStreamTrait,
	inject,
	type SecuritydeptInjectionToken,
} from "@securitydept/client";
import {
	type BaseOidcModeClient,
	TokenSetRefreshErrorAction,
	type TokenSetRefreshErrorHandler,
	TokenSetRefreshErrorPolicy,
	TokenSetRefreshOperation,
	TokenSetRefreshTrigger,
} from "@securitydept/token-set-context-client/orchestration";
import {
	TOKEN_SET_CLIENT_REGISTRY,
	TOKEN_SET_CLIENT_REGISTRY_ENTRIES,
	type TokenSetClientRegistry,
	type TokenSetClientRegistryEntry,
	type TokenSetClientRegistryError,
	type TokenSetClientRegistryEvent,
	TokenSetClientRegistryEventType,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
	createTokenSetClientRegistryForTest,
} from "@securitydept/token-set-context-client/test";
import { TOKEN_SET_CLIENT_REGISTRY as ANGULAR_TOKEN_SET_CLIENT_REGISTRY } from "@securitydept/token-set-context-client-angular";
import { type useTokenSetClientRegistry } from "@securitydept/token-set-context-client-react";

const client = createTokenSetClientForTest();
const entry = createTokenSetClientRegistryEntryForTest({
	clientKey: "artifact-client",
	client,
});
const testRegistry = createTokenSetClientRegistryForTest({ entries: [entry] });
const defaultRegistry = createTokenSetClientRegistryForTest();
const defaultClientResource =
	defaultRegistry.clientResourceFor("artifact-client");

type TestClient = typeof client;
type DefaultClient = Awaited<
	ReturnType<typeof defaultClientResource.whenValue>
>;

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;
type AssertTrue<T extends true> = T;
type RegistryTokenMustNotBeAny = AssertFalse<
	IsAny<typeof TOKEN_SET_CLIENT_REGISTRY>
>;
type RegistryEntriesTokenMustNotBeAny = AssertFalse<
	IsAny<typeof TOKEN_SET_CLIENT_REGISTRY_ENTRIES>
>;
type AngularRegistryTokenMustNotBeAny = AssertFalse<
	IsAny<typeof ANGULAR_TOKEN_SET_CLIENT_REGISTRY>
>;
type ReactRegistryMustNotBeAny = AssertFalse<
	IsAny<ReturnType<typeof useTokenSetClientRegistry>>
>;
type RegistryErrorKindMustNotBeAny = AssertFalse<
	IsAny<ReturnType<typeof TokenSetClientRegistryError.kindForCode>>
>;
type RegistryErrorRecoveryMustNotBeAny = AssertFalse<
	IsAny<ReturnType<typeof TokenSetClientRegistryError.recoveryForCode>>
>;

const registryToken: SecuritydeptInjectionToken<
	TokenSetClientRegistry<BaseOidcModeClient>
> = TOKEN_SET_CLIENT_REGISTRY;
const registryEntriesToken: SecuritydeptInjectionToken<
	readonly TokenSetClientRegistryEntry<BaseOidcModeClient>[]
> = TOKEN_SET_CLIENT_REGISTRY_ENTRIES;
const angularRegistryToken: InjectionToken<
	TokenSetClientRegistry<BaseOidcModeClient>
> = ANGULAR_TOKEN_SET_CLIENT_REGISTRY;

export function resolveRegistryArtifactTokens() {
	const registry = inject(TOKEN_SET_CLIENT_REGISTRY);
	const entries = inject(TOKEN_SET_CLIENT_REGISTRY_ENTRIES);
	const angularRegistry = angularInject(ANGULAR_TOKEN_SET_CLIENT_REGISTRY);
	return { registry, entries, angularRegistry };
}

type ResolvedRegistryTokens = ReturnType<typeof resolveRegistryArtifactTokens>;
type InjectedRegistryMustNotBeAny = AssertFalse<
	IsAny<ResolvedRegistryTokens["registry"]>
>;
type InjectedEntriesMustNotBeAny = AssertFalse<
	IsAny<ResolvedRegistryTokens["entries"]>
>;
type AngularInjectedRegistryMustNotBeAny = AssertFalse<
	IsAny<ResolvedRegistryTokens["angularRegistry"]>
>;
type ClientMustNotBeAny = AssertFalse<IsAny<typeof client>>;
type EntryMustNotBeAny = AssertFalse<IsAny<typeof entry>>;
type TestRegistryMustNotBeAny = AssertFalse<IsAny<typeof testRegistry>>;
type RegistryEventsIsAny = IsAny<TokenSetClientRegistry<TestClient>["events"]>;
type RegistryEventsMustNotBeAny = AssertFalse<RegistryEventsIsAny>;
type DefaultClientMustBeBaseOidcModeClient = AssertTrue<
	DefaultClient extends BaseOidcModeClient ? true : false
>;

const baseClientRegistry: TokenSetClientRegistry<BaseOidcModeClient> =
	defaultRegistry;

declare const registry: TokenSetClientRegistry<TestClient>;
const events: EventStreamTrait<TokenSetClientRegistryEvent<TestClient>> =
	registry.events;
const failedEventType: "failed" = TokenSetClientRegistryEventType.Failed;

export {
	type AngularInjectedRegistryMustNotBeAny,
	type AngularRegistryTokenMustNotBeAny,
	angularRegistryToken,
	baseClientRegistry,
	type ClientMustNotBeAny,
	type DefaultClientMustBeBaseOidcModeClient,
	type EntryMustNotBeAny,
	entry,
	events,
	failedEventType,
	type InjectedEntriesMustNotBeAny,
	type InjectedRegistryMustNotBeAny,
	type ReactRegistryMustNotBeAny,
	type RegistryEntriesTokenMustNotBeAny,
	type RegistryErrorKindMustNotBeAny,
	type RegistryErrorRecoveryMustNotBeAny,
	type RegistryEventsMustNotBeAny,
	type RegistryTokenMustNotBeAny,
	registryEntriesToken,
	registryToken,
	type TestRegistryMustNotBeAny,
	testRegistry,
};

export const refreshErrorHandler: TokenSetRefreshErrorHandler = async ({
	error,
	operation,
	trigger,
	clientId,
	cancellationToken,
}) => {
	cancellationToken.throwIfCancellationRequested();
	const identity: string = clientId;
	return identity &&
		error &&
		operation === TokenSetRefreshOperation.RestorePersistedState &&
		trigger === TokenSetRefreshTrigger.Initialization
		? TokenSetRefreshErrorAction.Unauthenticated
		: TokenSetRefreshErrorAction.Throw;
};
export const refreshErrorPolicies: TokenSetRefreshErrorPolicy[] = [
	TokenSetRefreshErrorPolicy.RevokeAsUnauthenticated,
	TokenSetRefreshErrorPolicy.RevokeAsUnauthenticatedOnInit,
	TokenSetRefreshErrorPolicy.Throw,
	refreshErrorHandler,
];
