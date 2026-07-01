import { describe, expect, it } from "vitest";

import {
	buildRootReadmeCratesBadgeShieldUrl,
	buildRootReadmeNpmBadgeShieldUrl,
	replaceRootReadmeBadgeShieldUrls,
} from "../readme-badges.ts";

const readmeSnippet = (npmBadgeUrl: string, cratesBadgeUrl: string) =>
	`<p class="badges" align="center">
  <a href="https://www.npmjs.com/package/@securitydept/client"><img src="${npmBadgeUrl}" alt="npm"></a>
  <a href="https://crates.io/crates/securitydept-core"><img src="${cratesBadgeUrl}" alt="crates.io"></a>
</p>`;

describe("readme-badges", () => {
	it("builds stable npm badge URLs without a dist-tag path segment", () => {
		expect(buildRootReadmeNpmBadgeShieldUrl("latest")).toBe(
			"https://img.shields.io/npm/v/%40securitydept%2Fclient?logo=npm&label=npm",
		);
	});

	it("builds prerelease npm badge URLs with release dist-tags", () => {
		expect(buildRootReadmeNpmBadgeShieldUrl("rc")).toBe(
			"https://img.shields.io/npm/v/%40securitydept%2Fclient/rc?logo=npm&label=npm",
		);
		expect(buildRootReadmeNpmBadgeShieldUrl("nightly")).toBe(
			"https://img.shields.io/npm/v/%40securitydept%2Fclient/nightly?logo=npm&label=npm",
		);
	});

	it("builds stable crates badge URLs from the registry", () => {
		expect(buildRootReadmeCratesBadgeShieldUrl("0.3.0", "latest")).toBe(
			"https://img.shields.io/crates/v/securitydept-core?logo=rust&label=crates.io",
		);
	});

	it("builds prerelease crates badge URLs pinned to the release version", () => {
		expect(buildRootReadmeCratesBadgeShieldUrl("0.3.0-beta.6", "rc")).toBe(
			"https://img.shields.io/badge/crates.io-0.3.0--beta.6-orange?logo=rust&label=crates.io",
		);
		expect(
			buildRootReadmeCratesBadgeShieldUrl("0.3.0-alpha.2", "nightly"),
		).toBe(
			"https://img.shields.io/badge/crates.io-0.3.0--alpha.2-orange?logo=rust&label=crates.io",
		);
	});

	it("replaces npm and crates badge URLs in root README snippets", () => {
		const stableSnippet = readmeSnippet(
			buildRootReadmeNpmBadgeShieldUrl("latest"),
			buildRootReadmeCratesBadgeShieldUrl("0.3.0", "latest"),
		);
		const betaSnippet = readmeSnippet(
			buildRootReadmeNpmBadgeShieldUrl("rc"),
			buildRootReadmeCratesBadgeShieldUrl("0.3.0-beta.6", "rc"),
		);

		expect(
			replaceRootReadmeBadgeShieldUrls(stableSnippet, "0.3.0-beta.6", "rc"),
		).toBe(betaSnippet);
		expect(
			replaceRootReadmeBadgeShieldUrls(betaSnippet, "0.3.0", "latest"),
		).toBe(stableSnippet);
	});
});
