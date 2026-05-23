export type BuiltinAuthWorkflowSourceOption<TOptions> =
	| false
	| "bundle"
	| { kind: "bundle"; options?: TOptions };
