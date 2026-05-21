// Frontend OIDC Mode — discovery compatibility helpers
//
// Keeps discovery-specific compatibility logic isolated from the main client.
// In particular, some providers publish a path-based issuer with a trailing
// slash while adopters often derive the issuer from well-known metadata without
// preserving that slash. oauth4webapi requires an exact issuer match, so the
// client should proactively inspect the discovery payload and choose the
// slash-equivalent issuer candidate before handing the response to
// processDiscoveryResponse.

export function buildIssuerDiscoveryCandidates(issuer: string): string[] {
	const trimmedIssuer = issuer.trim();
	if (!trimmedIssuer) return [issuer];

	let parsedIssuer: URL;
	try {
		parsedIssuer = new URL(trimmedIssuer);
	} catch {
		return [trimmedIssuer];
	}

	if (parsedIssuer.pathname === "/" || parsedIssuer.pathname === "") {
		return [trimmedIssuer];
	}

	const alternateIssuer = new URL(parsedIssuer.toString());
	if (alternateIssuer.pathname.endsWith("/")) {
		alternateIssuer.pathname = alternateIssuer.pathname.slice(0, -1);
	} else {
		alternateIssuer.pathname = `${alternateIssuer.pathname}/`;
	}

	const candidates = [trimmedIssuer, alternateIssuer.toString()];
	return candidates.filter(
		(candidate, index) => candidates.indexOf(candidate) === index,
	);
}

export async function resolveDiscoveryIssuerCompatibility(
	response: Response,
	configuredIssuer: string,
): Promise<string> {
	const issuerCandidates = buildIssuerDiscoveryCandidates(configuredIssuer);
	if (issuerCandidates.length === 1) {
		return issuerCandidates[0];
	}

	let body: unknown;
	try {
		body = await response.clone().json();
	} catch {
		return issuerCandidates[0];
	}

	if (
		body === null ||
		typeof body !== "object" ||
		!("issuer" in body) ||
		typeof body.issuer !== "string"
	) {
		return issuerCandidates[0];
	}

	const compatibleCandidate = issuerCandidates.find(
		(candidate) => candidate === body.issuer,
	);

	return compatibleCandidate ?? issuerCandidates[0];
}
