import { readFileSync } from "node:fs";

type HostPlatformAdapter = {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	readOsRelease?: () => string | undefined;
};

function parseOsReleaseValue(
	osReleaseText: string | undefined,
	key: string,
): string | undefined {
	if (!osReleaseText) {
		return undefined;
	}

	for (const line of osReleaseText.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith(`${key}=`)) {
			continue;
		}

		return trimmed
			.slice(key.length + 1)
			.replace(/^"|"$/g, "")
			.toLowerCase();
	}

	return undefined;
}

function readLinuxOsRelease(): string | undefined {
	try {
		return readFileSync("/etc/os-release", "utf8");
	} catch {
		return undefined;
	}
}

function isDebianLikeLinux(osReleaseText: string | undefined): boolean {
	const distroId = parseOsReleaseValue(osReleaseText, "ID");
	const distroLike = parseOsReleaseValue(osReleaseText, "ID_LIKE");
	return [distroId, distroLike].some((value) =>
		value
			?.split(/[\s]+/)
			.some((token) => token === "debian" || token === "ubuntu"),
	);
}

export function shouldPreferDistroboxHostedWebkit(
	adapter: HostPlatformAdapter = {},
): boolean {
	const platform = adapter.platform ?? process.platform;
	if (platform !== "linux") {
		return false;
	}

	const env = adapter.env ?? process.env;
	if (env.DISTROBOX_ENTER_PATH || env.CONTAINER_ID) {
		return true;
	}

	const osReleaseText = adapter.readOsRelease?.() ?? readLinuxOsRelease();
	return !isDebianLikeLinux(osReleaseText);
}
