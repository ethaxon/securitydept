const RELEASE_REQUEST_HEADERS = {
	"User-Agent": `securitydept-release-cli/${process.version}`,
	Accept: "application/json",
} as const;

export async function isNpmVersionPublished(
	packageName: string,
	version: string,
): Promise<boolean> {
	const response = await fetch(
		`https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
		{
			headers: RELEASE_REQUEST_HEADERS,
		},
	);

	if (response.status === 404) {
		return false;
	}

	if (!response.ok) {
		throw new Error(
			`Failed to query npm registry for ${packageName}: ${response.status} ${response.statusText}.`,
		);
	}

	const payload = (await response.json()) as {
		versions?: Record<string, unknown>;
	};
	return payload.versions != null && version in payload.versions;
}

export async function isCrateVersionPublished(
	crateName: string,
	version: string,
): Promise<boolean> {
	const response = await fetch(
		`https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}/${encodeURIComponent(version)}`,
		{
			headers: RELEASE_REQUEST_HEADERS,
		},
	);

	if (response.status === 404) {
		return false;
	}

	if (!response.ok) {
		throw new Error(
			`Failed to query crates.io for ${crateName}@${version}: ${response.status} ${response.statusText}.`,
		);
	}

	return true;
}
