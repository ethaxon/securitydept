import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { loadSecuritydeptMetadata } from "./metadata.ts";
import { resolveFromRoot } from "./paths.ts";
import { runCommand } from "./process.ts";
import { parseReleasePolicy } from "./release-policy.ts";
import { isNpmVersionPublished } from "./release-registry.ts";
import { ensureVersionConsistency } from "./version.ts";

export type NpmPublishOptions = {
	mode: "dry-run" | "publish";
	tag?: string;
	provenance: boolean;
	packDestination?: string;
};

function resolvePublishDirectory(
	manifestPath: string,
	packageName: string,
): string {
	const packageDirectory = path.dirname(resolveFromRoot(manifestPath));
	if (!packageName.endsWith("-angular")) {
		return packageDirectory;
	}

	const distDirectory = path.join(packageDirectory, "dist");
	const distManifestPath = path.join(distDirectory, "package.json");
	if (!existsSync(distManifestPath)) {
		throw new Error(
			`Angular package ${packageName} is missing ${distManifestPath}. Build the package before publishing.`,
		);
	}

	return packageDirectory;
}

export async function runNpmPublish(options: NpmPublishOptions): Promise<void> {
	ensureVersionConsistency();

	const metadata = loadSecuritydeptMetadata();
	const releasePolicy = parseReleasePolicy(metadata.project.version);
	const distTag = options.tag ?? metadata.npm.defaultDistTag;
	const releaseVersion = releasePolicy.version.version;
	const disableGitChecks = shouldDisableGitChecks();
	let skippedAlreadyPublishedCount = 0;

	if (releasePolicy.track !== "stable" && distTag === "latest") {
		throw new Error(
			`Refusing to publish prerelease version ${releasePolicy.version.version} with dist-tag latest.`,
		);
	}

	const packDestination = resolveFromRoot(
		options.packDestination ?? metadata.npm.packDestination,
	);
	mkdirSync(packDestination, { recursive: true });

	const publishablePackages = metadata.nodePackages.filter(
		(pkg) => pkg.publish,
	);
	const skippedPackages = metadata.nodePackages.filter((pkg) => !pkg.publish);

	for (const pkg of skippedPackages) {
		console.log(
			`Skipping ${pkg.name} (${pkg.manifest}) because publish=false.`,
		);
	}

	for (const pkg of publishablePackages) {
		if (
			options.mode === "publish" &&
			(await isNpmVersionPublished(pkg.name, releaseVersion))
		) {
			skippedAlreadyPublishedCount += 1;
			console.log(
				`Skipping ${pkg.name}@${releaseVersion} because that version is already published on npm.`,
			);
			continue;
		}

		const publishDirectory = resolvePublishDirectory(pkg.manifest, pkg.name);

		console.log(
			`Packing ${pkg.name} from ${path.relative(process.cwd(), publishDirectory)}.`,
		);
		runCommand("pnpm", ["pack", `--pack-destination=${packDestination}`], {
			cwd: publishDirectory,
		});

		const publishArgs = ["publish", `--tag=${distTag}`];
		if (options.mode === "dry-run") {
			publishArgs.push("--dry-run");
		}
		if (disableGitChecks) {
			publishArgs.push("--no-git-checks");
		}
		if (options.provenance) {
			publishArgs.push("--provenance");
		}

		console.log(
			`${options.mode === "dry-run" ? "Dry-running" : "Publishing"} ${pkg.name} with dist-tag ${distTag}.`,
		);
		runCommand("pnpm", publishArgs, { cwd: publishDirectory });
	}

	console.log(
		`${options.mode === "dry-run" ? "Dry-run completed" : "Publish completed"} for ${publishablePackages.length - skippedAlreadyPublishedCount} npm packages${
			skippedAlreadyPublishedCount > 0
				? `; skipped ${skippedAlreadyPublishedCount} already-published version(s).`
				: "."
		}`,
	);
}

function shouldDisableGitChecks(): boolean {
	return process.env.GITHUB_ACTIONS === "true";
}
