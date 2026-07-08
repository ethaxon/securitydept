import { type EventStreamTrait } from "@securitydept/client";
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

type TestClient = typeof client;

type IsAny<T> = 0 extends 1 & T ? true : false;
type AssertFalse<T extends false> = T;
type RegistryEventsIsAny = IsAny<TokenSetClientRegistry<TestClient>["events"]>;
type RegistryEventsMustNotBeAny = AssertFalse<RegistryEventsIsAny>;

declare const registry: TokenSetClientRegistry<TestClient>;
const events: EventStreamTrait<TokenSetClientRegistryEvent<TestClient>> =
	registry.events;
const failedEventType: "failed" = TokenSetClientRegistryEventType.Failed;

export {
	entry,
	events,
	failedEventType,
	type RegistryEventsMustNotBeAny,
	testRegistry,
};
