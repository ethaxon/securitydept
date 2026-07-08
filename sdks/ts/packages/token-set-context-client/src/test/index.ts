/**
 * Dependency-light Token Set client and registry fixtures.
 *
 * This subpath intentionally has no test-runner or framework dependencies.
 */
export {
	type CreateTokenSetClientForTestOptions,
	createTokenSetClientForTest,
	TokenSetClientForTest,
	type TokenSetClientForTestRefreshOptions,
} from "./client";
export {
	type CreateTokenSetClientRegistryEntryForTestOptions,
	type CreateTokenSetClientRegistryForTestOptions,
	createTokenSetClientRegistryEntryForTest,
	createTokenSetClientRegistryForTest,
} from "./registry";
