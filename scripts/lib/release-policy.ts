import semver from "semver";

export const ReleaseTrack = {
	Stable: "stable",
	Alpha: "alpha",
	Beta: "beta",
} as const;

export type ReleaseTrack = (typeof ReleaseTrack)[keyof typeof ReleaseTrack];

export type ReleasePolicy = {
	version: semver.SemVer;
	track: ReleaseTrack;
	npmDistTag: "latest" | "nightly" | "rc";
	dockerChannelTags: string[];
	gitTag: string;
};

export function parseReleasePolicy(versionText: string): ReleasePolicy {
	const parsedVersion = semver.parse(versionText);
	if (!parsedVersion) {
		throw new Error(`Invalid release version: ${versionText}`);
	}

	if (parsedVersion.build.length > 0) {
		throw new Error(
			`Release versions must not include build metadata: ${parsedVersion.version}`,
		);
	}

	if (parsedVersion.prerelease.length === 0) {
		return {
			version: parsedVersion,
			track: ReleaseTrack.Stable,
			npmDistTag: "latest",
			dockerChannelTags: ["latest", "release"],
			gitTag: `v${parsedVersion.version}`,
		};
	}

	if (parsedVersion.prerelease.length !== 2) {
		throw unsupportedVersionError(parsedVersion.version);
	}

	const [channel, iteration] = parsedVersion.prerelease;
	if (
		(channel !== ReleaseTrack.Alpha && channel !== ReleaseTrack.Beta) ||
		typeof iteration !== "number" ||
		!Number.isInteger(iteration) ||
		iteration < 0
	) {
		throw unsupportedVersionError(parsedVersion.version);
	}

	return {
		version: parsedVersion,
		track: channel,
		npmDistTag: channel === ReleaseTrack.Alpha ? "nightly" : "rc",
		dockerChannelTags: channel === ReleaseTrack.Alpha ? ["nightly"] : ["rc"],
		gitTag: `v${parsedVersion.version}`,
	};
}

function unsupportedVersionError(version: string): Error {
	return new Error(
		`Unsupported release version '${version}'. Expected X.Y.Z, X.Y.Z-alpha.N, or X.Y.Z-beta.N.`,
	);
}
