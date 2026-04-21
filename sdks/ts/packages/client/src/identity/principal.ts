export interface AuthenticatedPrincipal {
	subject: string;
	displayName: string;
	picture?: string;
	issuer?: string;
	claims?: Record<string, unknown>;
}

type PrincipalObject = Record<string, unknown>;

function readClaimsBag(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function resolveDisplayName(displayName: unknown, subject: string): string {
	if (typeof displayName === "string" && displayName.trim().length > 0) {
		return displayName;
	}

	return subject;
}

export function normalizeAuthenticatedPrincipal(
	input: PrincipalObject,
): AuthenticatedPrincipal | null {
	if (typeof input.subject !== "string" || input.subject.trim().length === 0) {
		return null;
	}

	return {
		subject: input.subject,
		displayName: resolveDisplayName(input.displayName, input.subject),
		picture: readOptionalString(input.picture),
		issuer: readOptionalString(input.issuer),
		claims: readClaimsBag(input.claims),
	};
}

export function normalizeAuthenticatedPrincipalWire(
	input: PrincipalObject,
): AuthenticatedPrincipal | null {
	if (typeof input.subject !== "string" || input.subject.trim().length === 0) {
		return null;
	}

	return {
		subject: input.subject,
		displayName: resolveDisplayName(input.display_name, input.subject),
		picture: readOptionalString(input.picture),
		issuer: readOptionalString(input.issuer),
		claims: readClaimsBag(input.claims),
	};
}

export interface ProjectAuthenticatedPrincipalOptions {
	principal?: AuthenticatedPrincipal | null;
	fallbackDisplayName?: string;
	fallbackSubject?: string;
	fallbackIssuer?: string;
	fallbackClaims?: Record<string, unknown>;
}

export function projectAuthenticatedPrincipal(
	options: ProjectAuthenticatedPrincipalOptions,
): AuthenticatedPrincipal {
	const principal = options.principal;
	const subject =
		principal?.subject ?? options.fallbackSubject ?? "context.anonymous";
	const displayName =
		principal?.displayName?.trim() || options.fallbackDisplayName || subject;

	return {
		subject,
		displayName,
		picture: principal?.picture,
		issuer: principal?.issuer ?? options.fallbackIssuer,
		claims: principal?.claims ?? options.fallbackClaims,
	};
}
