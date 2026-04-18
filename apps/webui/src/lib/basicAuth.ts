export const BasicAuthBoundaryKind = {
	Authenticated: "authenticated",
	Challenge: "challenge",
	Unauthorized: "unauthorized",
	LogoutPoison: "logout_poison",
} as const;

export type BasicAuthBoundaryKind =
	(typeof BasicAuthBoundaryKind)[keyof typeof BasicAuthBoundaryKind];

export function buildBasicAuthLoginUrl(postAuthRedirectUri: string): string {
	const params = new URLSearchParams({
		post_auth_redirect_uri: postAuthRedirectUri,
	});
	return `/basic/login?${params.toString()}`;
}

export function readBasicAuthBoundaryKind(options: {
	status: number;
	challengeHeader?: string | null;
	requestPath?: string;
}): BasicAuthBoundaryKind {
	if (options.status < 400) {
		return BasicAuthBoundaryKind.Authenticated;
	}

	if (options.challengeHeader) {
		return BasicAuthBoundaryKind.Challenge;
	}

	if (options.status === 401 && options.requestPath === "/basic/logout") {
		return BasicAuthBoundaryKind.LogoutPoison;
	}

	return BasicAuthBoundaryKind.Unauthorized;
}
