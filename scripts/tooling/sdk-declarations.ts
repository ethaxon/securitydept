import { type DtsOptions } from "tsdown";

/** Keep package declarations independent of untracked tsc build outputs. */
export const SDK_DECLARATION_OPTIONS: DtsOptions = {
	tsconfigRaw: { references: [] },
	compilerOptions: {
		// Turbo builds dependency artifacts first; consumers resolve those same exports.
		customConditions: [],
	},
};
