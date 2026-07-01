import {
	collectCargoDependencyVersionMismatches,
	readManifestVersion,
	writeCargoDependencyVersionRequirements,
	writeManifestVersion,
} from "./manifest-version.ts";
import {
	loadSecuritydeptMetadata,
	writeSecuritydeptMetadataVersion,
} from "./metadata.ts";
import { resolveFromRoot } from "./paths.ts";
import { syncRootReadmeBadges } from "./readme-badges.ts";
import { parseReleasePolicy } from "./release-policy.ts";

export type VersionMismatch = {
	kind: "manifest-version" | "cargo-dependency-version";
	name: string;
	manifest: string;
	expectedVersion: string;
	actualVersion: string;
};

export function collectVersionMismatches(): VersionMismatch[] {
	const metadata = loadSecuritydeptMetadata();
	const versionedPackages = [
		...metadata.nodePackages,
		...metadata.rustPackages,
	];
	const publishableRustPackageNames = new Set(
		metadata.rustPackages.filter((pkg) => pkg.publish).map((pkg) => pkg.name),
	);
	const expectedCargoDependencyVersion = `~${metadata.project.version}`;

	const manifestMismatches = versionedPackages.flatMap((pkg) => {
		const actualVersion = readManifestVersion(resolveFromRoot(pkg.manifest));
		if (actualVersion === metadata.project.version) {
			return [];
		}

		return [
			{
				kind: "manifest-version" as const,
				name: pkg.name,
				manifest: pkg.manifest,
				expectedVersion: metadata.project.version,
				actualVersion,
			},
		];
	});

	const cargoDependencyMismatches = metadata.rustPackages
		.filter((pkg) => pkg.publish)
		.flatMap((pkg) =>
			collectCargoDependencyVersionMismatches(
				resolveFromRoot(pkg.manifest),
				publishableRustPackageNames,
				expectedCargoDependencyVersion,
			).map((mismatch) => ({
				kind: "cargo-dependency-version" as const,
				name: `${pkg.name} -> ${mismatch.dependencyName}`,
				manifest: pkg.manifest,
				expectedVersion: mismatch.expectedVersionRequirement,
				actualVersion: mismatch.actualVersionRequirement ?? "<missing>",
			})),
		);

	return [...manifestMismatches, ...cargoDependencyMismatches];
}

export function ensureVersionConsistency(): void {
	const mismatches = collectVersionMismatches();
	if (mismatches.length === 0) {
		console.log(
			"All release-managed manifests match securitydept-metadata.toml.",
		);
		return;
	}

	for (const mismatch of mismatches) {
		const prefix =
			mismatch.kind === "cargo-dependency-version"
				? "cargo dependency version mismatch"
				: "manifest version mismatch";
		console.error(
			`${prefix}: ${mismatch.name}: expected ${mismatch.expectedVersion}, found ${mismatch.actualVersion} (${mismatch.manifest})`,
		);
	}

	throw new Error(`Found ${mismatches.length} release version mismatches.`);
}

export function setWorkspaceVersion(nextVersionText: string): void {
	const releasePolicy = parseReleasePolicy(nextVersionText);
	const metadata = writeSecuritydeptMetadataVersion(
		releasePolicy.version.version,
	);
	const versionedPackages = [
		...metadata.nodePackages,
		...metadata.rustPackages,
	];
	const publishableRustPackageNames = new Set(
		metadata.rustPackages.filter((pkg) => pkg.publish).map((pkg) => pkg.name),
	);
	const expectedCargoDependencyVersion = `~${metadata.project.version}`;
	let updatedCargoDependencyCount = 0;

	for (const pkg of versionedPackages) {
		writeManifestVersion(
			resolveFromRoot(pkg.manifest),
			metadata.project.version,
		);

		if (!pkg.publish) {
			continue;
		}

		updatedCargoDependencyCount += writeCargoDependencyVersionRequirements(
			resolveFromRoot(pkg.manifest),
			publishableRustPackageNames,
			expectedCargoDependencyVersion,
		);
	}

	const updatedReadmeCount = syncRootReadmeBadges(
		metadata.project.version,
		releasePolicy.npmDistTag,
	);

	console.log(
		`Updated ${versionedPackages.length} release-managed manifests, ${updatedCargoDependencyCount} Cargo dependency version entries, and ${updatedReadmeCount} root README badge file(s) to ${metadata.project.version} (npm dist-tag: ${releasePolicy.npmDistTag}).`,
	);
}
