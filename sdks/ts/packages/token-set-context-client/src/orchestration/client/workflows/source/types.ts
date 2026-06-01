export const AuthWorkflowSourceConfigKind = {
	Bundle: "bundle",
	None: "none",
} as const;

export type AuthWorkflowSourceConfigKind =
	(typeof AuthWorkflowSourceConfigKind)[keyof typeof AuthWorkflowSourceConfigKind];

export type BuiltinAuthWorkflowSourceConfig<TOptions> =
	| typeof AuthWorkflowSourceConfigKind.Bundle
	| { kind: typeof AuthWorkflowSourceConfigKind.Bundle; options?: TOptions }
	| undefined // equals to bundle with default options
	| false;

export function normalizeBuiltinAuthWorkflowSourceConfig<
	TBundleOptions,
	DBundleOptions = {},
>(
	option: BuiltinAuthWorkflowSourceConfig<TBundleOptions>,
	defaultOptions?: DBundleOptions,
):
	| {
			kind: typeof AuthWorkflowSourceConfigKind.Bundle;
			options: (TBundleOptions & DBundleOptions) | DBundleOptions;
	  }
	| {
			kind: typeof AuthWorkflowSourceConfigKind.None;
			options: DBundleOptions;
	  } {
	if (option === AuthWorkflowSourceConfigKind.Bundle || option === undefined) {
		return {
			kind: AuthWorkflowSourceConfigKind.Bundle,
			options: Object.assign({}, defaultOptions),
		};
	} else if (option && option?.kind === AuthWorkflowSourceConfigKind.Bundle) {
		return {
			kind: AuthWorkflowSourceConfigKind.Bundle,
			options: Object.assign({}, defaultOptions, option.options),
		};
	} else {
		return {
			kind: AuthWorkflowSourceConfigKind.None,
			options: Object.assign({}, defaultOptions),
		};
	}
}
