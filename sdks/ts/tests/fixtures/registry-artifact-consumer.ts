import { type EventStreamTrait } from "@securitydept/client";
import {
	type BaseOidcModeClient,
	TokenSetRefreshErrorAction,
	type TokenSetRefreshErrorHandler,
	TokenSetRefreshErrorPolicy,
	TokenSetRefreshOperation,
	TokenSetRefreshTrigger,
} from "@securitydept/token-set-context-client/orchestration";
import {
	type TokenSetClientRegistry,
	type TokenSetClientRegistryEvent,
	TokenSetClientRegistryEventType,
} from "@securitydept/token-set-context-client/registry";
import {
	createTokenSetClientForTest,
	createTokenSetClientRegistryEntryForTest,
	createTokenSetClientRegistryForTest,
} from "@securitydept/token-set-context-client/test";

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
	baseClientRegistry,
	type ClientMustNotBeAny,
	type DefaultClientMustBeBaseOidcModeClient,
	type EntryMustNotBeAny,
	entry,
	events,
	failedEventType,
	type RegistryEventsMustNotBeAny,
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
