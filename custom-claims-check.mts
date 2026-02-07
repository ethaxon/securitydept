/**
 * This script is used to check the claims and return the displayName and claims
 * And for running at rust server, it will be compiled to modren ecamscript running in boa_engine
 * You should *not* use any external dependencies that are not supported by boa_engine
 */

interface Claims {
	scope: string;
	preferred_username?: string;
	nickname?: string;
	sub: string;
	email?: string;
	picture?: string;
}

interface CheckSuccessResult {
	success: true;
	display_name: string;
	picture?: string;
	claims: Claims;
}

interface CheckFailureResult {
	success: false;
	error: Error;
	claims: Claims;
}

type CheckResult = CheckSuccessResult | CheckFailureResult;

// use default export function
export default function claimsCheck(claims: Claims): CheckResult {
	const displayName =
		claims?.preferred_username || claims?.nickname || claims.sub;
	const picture = claims?.picture;
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
		display_name: displayName,
		picture,
		claims,
	};
}
