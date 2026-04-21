import {
	type AuthenticatedPrincipal,
	projectAuthenticatedPrincipal,
} from "@securitydept/client";

export interface DashboardUser {
	displayName: string;
	picture?: string;
	contextLabel: string;
	showIdentity?: boolean;
}

export interface ProjectDashboardUserOptions {
	principal?: AuthenticatedPrincipal | null;
	contextLabel: string;
	fallbackDisplayName?: string;
	fallbackSubject?: string;
	showIdentity?: boolean;
}

export function projectDashboardUser(
	options: ProjectDashboardUserOptions,
): DashboardUser {
	const principal = projectAuthenticatedPrincipal({
		principal: options.principal,
		fallbackDisplayName: options.fallbackDisplayName,
		fallbackSubject: options.fallbackSubject,
	});

	return {
		displayName: principal.displayName,
		picture: principal.picture,
		contextLabel: options.contextLabel,
		showIdentity: options.showIdentity,
	};
}
