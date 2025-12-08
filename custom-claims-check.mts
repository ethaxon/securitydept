/**
 * This script is used to check the claims and return the displayName and claims
 * And for running at rust server, it will be compiled to modren ecamscript running in boa_engine
 * You should *not* use any external dependencies that are not supported by boa_engine
 */

interface Claims {
	scope: string;
	preferred_username?: string;
	username?: string;
	sub: string;
}

interface CheckSuccessResult {
	success: true;
	displayName: string;
	claims: Claims;
}

interface CheckFailureResult {
	success: false;
	error: Error;
	claims: Claims;
}

type CheckResult = CheckSuccessResult | CheckFailureResult;

export default function claimsCheck(claims: Claims): CheckResult {
	const displayName =
		claims?.preferred_username || claims?.username || claims.sub;
	if (!displayName) {
		return {
			success: false,
			error: new Error(
				"for showing displayName, claims field preferred_username or username or sub is required",
			),
			claims,
		};
	}
	return {
		success: true,
		displayName,
		claims,
	};
}
