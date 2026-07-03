export {
	CLIENT_ERROR_SPAN_ATTRIBUTE_PROVIDER_ID,
	ClientError,
	type ClientErrorFromHttpResponseOptions,
	type ClientErrorFromUnknownOptions,
} from "./client-error";
export {
	describeError,
	type ErrorSummary,
} from "./error-attributes";
export {
	formatClientErrorContext,
	readErrorPresentationDescriptor,
} from "./presentation-descriptor";
export {
	type ClientErrorContextFormatter,
	ClientErrorKind,
	ClientErrorSource,
	type ClientErrorSpanContext,
	type ErrorCodePresentation,
	type ErrorPresentationDescriptor,
	ErrorPresentationTone,
	type ErrorRecoveryActionDescriptor,
	type ReadErrorPresentationDescriptorOptions,
	type ServerErrorPresentation,
	UserRecovery,
} from "./types";
