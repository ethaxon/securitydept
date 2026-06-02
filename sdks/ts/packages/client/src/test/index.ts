/**
 * Dependency-light test factories for SecurityDept foundation traits.
 *
 * Keep this subpath free of test-runner, DOM-polyfill, framework, or e2e
 * dependencies. Helpers that need those capabilities belong in
 * @securitydept/test-utils or e2e-utils.
 */
export {
	type CreateEnvironmentForTestOptions,
	createEnvironmentForTest,
} from "./environment";
export {
	createIdleCallbackForTest,
	type TestIdleCallbackTrait,
} from "./idle-callback";
export {
	createEventSubjectForTest,
	createPageLifecycleForTest,
	type TestEventSubjectTrait,
	type TestPageLifecycleTrait,
} from "./page-lifecycle";
export {
	createPopupForTest,
	type PopupForTestCreateOptions,
	type PopupForTestOpenCall,
	type TestPopupTrait,
} from "./popup";
export {
	createRouterForTest,
	type RouterForTestCreateOptions,
	type TestRouterTrait,
} from "./router";
export {
	createStorageForTest,
	type StorageForTestCreateOptions,
} from "./storage";
export {
	createTimeForTest,
	type TestTimeTrait,
	type TimeForTestCreateOptions,
} from "./time";
export {
	createTransportForTest,
	type TestTransportTrait,
	type TransportForTestCreateOptions,
	type TransportForTestRoute,
} from "./transport";
