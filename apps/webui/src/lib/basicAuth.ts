export function buildBasicAuthLoginUrl(postAuthRedirectUri: string): string {
	const params = new URLSearchParams({
		post_auth_redirect_uri: postAuthRedirectUri,
	});
	return `/basic/login?${params.toString()}`;
}
