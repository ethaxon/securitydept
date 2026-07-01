import { readFileSync, writeFileSync } from "node:fs";

import { resolveFromRoot } from "./paths.ts";
import { type ReleasePolicy } from "./release-policy.ts";

const ROOT_README_PATHS = ["README.md", "README_zh.md"] as const;
const NPM_BADGE_PACKAGE_PATH = "%40securitydept%2Fclient";
const NPM_BADGE_QUERY = "?logo=npm&label=npm";
const CRATES_BADGE_PACKAGE = "securitydept-core";
const CRATES_BADGE_QUERY = "?logo=rust&label=crates.io";
const NPM_BADGE_IMG_SRC_PATTERN = new RegExp(
	`https://img\\.shields\\.io/npm/v/${NPM_BADGE_PACKAGE_PATH}(?:/(?:rc|nightly))?\\?logo=npm&label=npm`,
	"gu",
);
const CRATES_BADGE_IMG_SRC_PATTERN = new RegExp(
	`https://img\\.shields\\.io/(?:crates/v/${CRATES_BADGE_PACKAGE}|badge/crates\\.io-[\\d.]+(?:--[a-z]+(?:\\.[\\d]+)*)?-orange)\\?logo=rust&label=crates\\.io`,
	"gu",
);

export function buildRootReadmeNpmBadgeShieldUrl(
	npmDistTag: ReleasePolicy["npmDistTag"],
): string {
	const distTagPath =
		npmDistTag === "latest" ? "" : `/${encodeURIComponent(npmDistTag)}`;
	return `https://img.shields.io/npm/v/${NPM_BADGE_PACKAGE_PATH}${distTagPath}${NPM_BADGE_QUERY}`;
}

export function buildRootReadmeCratesBadgeShieldUrl(
	version: string,
	npmDistTag: ReleasePolicy["npmDistTag"],
): string {
	if (npmDistTag === "latest") {
		return `https://img.shields.io/crates/v/${CRATES_BADGE_PACKAGE}${CRATES_BADGE_QUERY}`;
	}

	const escapedVersion = version.replaceAll("-", "--");
	return `https://img.shields.io/badge/crates.io-${escapedVersion}-orange${CRATES_BADGE_QUERY}`;
}

export function replaceRootReadmeNpmBadgeShieldUrl(
	source: string,
	npmDistTag: ReleasePolicy["npmDistTag"],
): string {
	const nextBadgeUrl = buildRootReadmeNpmBadgeShieldUrl(npmDistTag);
	return source.replace(NPM_BADGE_IMG_SRC_PATTERN, nextBadgeUrl);
}

export function replaceRootReadmeCratesBadgeShieldUrl(
	source: string,
	version: string,
	npmDistTag: ReleasePolicy["npmDistTag"],
): string {
	const nextBadgeUrl = buildRootReadmeCratesBadgeShieldUrl(version, npmDistTag);
	return source.replace(CRATES_BADGE_IMG_SRC_PATTERN, nextBadgeUrl);
}

export function replaceRootReadmeBadgeShieldUrls(
	source: string,
	version: string,
	npmDistTag: ReleasePolicy["npmDistTag"],
): string {
	return replaceRootReadmeCratesBadgeShieldUrl(
		replaceRootReadmeNpmBadgeShieldUrl(source, npmDistTag),
		version,
		npmDistTag,
	);
}

export function syncRootReadmeBadges(
	version: string,
	npmDistTag: ReleasePolicy["npmDistTag"],
): number {
	let updatedCount = 0;

	for (const readmePath of ROOT_README_PATHS) {
		const absolutePath = resolveFromRoot(readmePath);
		const currentSource = readFileSync(absolutePath, "utf8");
		const nextSource = replaceRootReadmeBadgeShieldUrls(
			currentSource,
			version,
			npmDistTag,
		);

		if (nextSource === currentSource) {
			continue;
		}

		writeFileSync(absolutePath, nextSource);
		updatedCount += 1;
	}

	return updatedCount;
}
