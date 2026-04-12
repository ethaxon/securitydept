/**
 * Vitest setup for Angular adapter tests.
 *
 * 1. Verifies that ng-packagr dist artefacts exist (tests import the built
 *    FESM bundles, not source, because vitest cannot parse Angular decorators).
 * 2. Loads the Angular JIT compiler so partially-compiled libraries can be
 *    resolved at runtime without the Angular Linker / CLI.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Pre-flight: ensure Angular packages have been built
// ---------------------------------------------------------------------------

const ANGULAR_PACKAGES = [
	"client-angular",
	"basic-auth-context-client-angular",
	"session-context-client-angular",
	"token-set-context-client-angular",
] as const;

const packagesDir = resolve(import.meta.dirname, "packages");

const missing: string[] = [];
for (const pkg of ANGULAR_PACKAGES) {
	const fesmDir = resolve(packagesDir, pkg, "dist", "fesm2022");
	if (!existsSync(fesmDir)) {
		missing.push(`@securitydept/${pkg}`);
	}
}

if (missing.length > 0) {
	throw new Error(
		[
			"Angular adapter tests require a prior build because vitest imports",
			"the ng-packagr FESM output (not source). The following packages have",
			"no dist/ artefacts:\n",
			...missing.map((p) => `  • ${p}`),
			"\nRun `pnpm build` (or `pnpm build:angular`) first, then re-run tests.",
		].join("\n"),
	);
}

// ---------------------------------------------------------------------------
// Load Angular JIT compiler for partial-compiled ng-packagr output
// ---------------------------------------------------------------------------
import "@angular/compiler";
