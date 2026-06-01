export const TokenSetAuthWorkflowSourceConfigKind = {
	Bundle: "bundle",
	None: "none",
} as const;

export type TokenSetAuthWorkflowSourceConfigKind =
	(typeof TokenSetAuthWorkflowSourceConfigKind)[keyof typeof TokenSetAuthWorkflowSourceConfigKind];

export type TokenSetBuiltinAuthWorkflowSourceConfig<TOptions> =
	| typeof TokenSetAuthWorkflowSourceConfigKind.Bundle
	| {
			kind: typeof TokenSetAuthWorkflowSourceConfigKind.Bundle;
			options?: TOptions;
	  }
	| undefined // equals to bundle with default options
	| false;

export function normalizeTokenSetBuiltinAuthWorkflowSourceConfig<
	TBundleOptions,
	DBundleOptions = {},
>(
	option: TokenSetBuiltinAuthWorkflowSourceConfig<TBundleOptions>,
	defaultOptions?: DBundleOptions,
):
	| {
			kind: typeof TokenSetAuthWorkflowSourceConfigKind.Bundle;
			options: (TBundleOptions & DBundleOptions) | DBundleOptions;
	  }
	| {
			kind: typeof TokenSetAuthWorkflowSourceConfigKind.None;
			options: DBundleOptions;
	  } {
	if (
		option === TokenSetAuthWorkflowSourceConfigKind.Bundle ||
		option === undefined
	) {
		return {
			kind: TokenSetAuthWorkflowSourceConfigKind.Bundle,
			options: Object.assign({}, defaultOptions),
		};
	} else if (
		option &&
		option?.kind === TokenSetAuthWorkflowSourceConfigKind.Bundle
	) {
		return {
			kind: TokenSetAuthWorkflowSourceConfigKind.Bundle,
			options: Object.assign({}, defaultOptions, option.options),
		};
	} else {
		return {
			kind: TokenSetAuthWorkflowSourceConfigKind.None,
			options: Object.assign({}, defaultOptions),
		};
	}
}
