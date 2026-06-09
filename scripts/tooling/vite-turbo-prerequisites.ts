import { type Plugin } from "vite";
import {
	type RunTurboPrerequisitesOptions,
	runTurboPrerequisites,
} from "./turbo-prerequisites.ts";

export function createTurboPrerequisitesVitePlugin(
	options: RunTurboPrerequisitesOptions,
): Plugin {
	return {
		name: "securitydept-turbo-prerequisites",
		enforce: "pre",
		async buildStart() {
			await runTurboPrerequisites(options);
		},
	};
}
