import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
	type CreateBasicEntryRequest,
	type CreateGroupRequest,
	type CreateTokenEntryRequest,
	createBasicEntry,
	createGroup,
	createTokenEntry,
	deleteEntry,
	deleteGroup,
	getEntry,
	getGroup,
	listEntries,
	listGroups,
	type UpdateEntryRequest,
	type UpdateGroupRequest,
	updateEntry,
	updateGroup,
} from "@/api/dashboard";
import { AuthContextMode } from "@/auth/model";
import { useAuthMode, useAuthService, useAuthUser } from "@/auth/react";

export const dashboardQueryKeys = {
	root: ["dashboard"] as const,
	groups: (mode: AuthContextMode | null) =>
		[...dashboardQueryKeys.root, mode, "groups"] as const,
	group: (mode: AuthContextMode | null, groupId: string) =>
		[...dashboardQueryKeys.groups(mode), groupId] as const,
	entries: (mode: AuthContextMode | null) =>
		[...dashboardQueryKeys.root, mode, "entries"] as const,
	entry: (mode: AuthContextMode | null, entryId: string) =>
		[...dashboardQueryKeys.entries(mode), entryId] as const,
	currentUser: (mode: AuthContextMode | null) =>
		[...dashboardQueryKeys.root, mode, "current-user"] as const,
} as const;

export function useCurrentDashboardUser() {
	const authUser = useAuthUser();
	const mode = useAuthMode();
	return useQuery({
		queryKey: dashboardQueryKeys.currentUser(mode),
		queryFn: async () => authUser?.userInfo ?? null,
		initialData: authUser?.userInfo ?? null,
	});
}

export function useDashboardAccessNotice() {
	const authUser = useAuthUser();
	const mode = useAuthMode();
	if (
		(mode === AuthContextMode.TokenSetBackend ||
			mode === AuthContextMode.TokenSetFrontend) &&
		authUser === null
	) {
		return {
			title: "Token-set authorization is not ready",
			description:
				"Token-set mode is selected, but no dashboard bearer is available yet. Sign in again before loading protected API data.",
		};
	}
	return null;
}

export function useGroupsQuery() {
	const authService = useAuthService();
	const mode = useAuthMode();
	return useQuery({
		queryKey: dashboardQueryKeys.groups(mode),
		queryFn: async ({ signal }) =>
			listGroups(await authService.resolveDashboardAccess(), {
				abortSignal: signal,
			}),
		refetchOnWindowFocus: false,
	});
}

export function useGroupQuery(groupId: string) {
	const authService = useAuthService();
	const mode = useAuthMode();
	return useQuery({
		queryKey: dashboardQueryKeys.group(mode, groupId),
		queryFn: async ({ signal }) =>
			getGroup(await authService.resolveDashboardAccess(), groupId, {
				abortSignal: signal,
			}),
		enabled: Boolean(groupId),
		refetchOnWindowFocus: false,
	});
}

export function useEntriesQuery() {
	const authService = useAuthService();
	const mode = useAuthMode();
	return useQuery({
		queryKey: dashboardQueryKeys.entries(mode),
		queryFn: async ({ signal }) =>
			listEntries(await authService.resolveDashboardAccess(), {
				abortSignal: signal,
			}),
		refetchOnWindowFocus: false,
	});
}

export function useEntryQuery(entryId: string) {
	const authService = useAuthService();
	const mode = useAuthMode();
	return useQuery({
		queryKey: dashboardQueryKeys.entry(mode, entryId),
		queryFn: async ({ signal }) =>
			getEntry(await authService.resolveDashboardAccess(), entryId, {
				abortSignal: signal,
			}),
		enabled: Boolean(entryId),
		refetchOnWindowFocus: false,
	});
}

export function useCreateGroupMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: CreateGroupRequest) =>
			createGroup(await authService.resolveDashboardAccess(), input),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dashboardQueryKeys.root,
			});
		},
	});
}

export function useUpdateGroupMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, ...input }: UpdateGroupRequest & { id: string }) =>
			updateGroup(await authService.resolveDashboardAccess(), id, input),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dashboardQueryKeys.root,
			});
		},
	});
}

export function useDeleteGroupMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (groupId: string) =>
			deleteGroup(await authService.resolveDashboardAccess(), groupId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dashboardQueryKeys.root,
			});
		},
	});
}

export function useCreateBasicEntryMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: CreateBasicEntryRequest) =>
			createBasicEntry(await authService.resolveDashboardAccess(), input),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dashboardQueryKeys.root,
			});
		},
	});
}

export function useCreateTokenEntryMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (input: CreateTokenEntryRequest) =>
			createTokenEntry(await authService.resolveDashboardAccess(), input),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dashboardQueryKeys.root,
			});
		},
	});
}

export function useUpdateEntryMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ id, ...input }: UpdateEntryRequest & { id: string }) =>
			updateEntry(await authService.resolveDashboardAccess(), id, input),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dashboardQueryKeys.root,
			});
		},
	});
}

export function useDeleteEntryMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (entryId: string) =>
			deleteEntry(await authService.resolveDashboardAccess(), entryId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: dashboardQueryKeys.root,
			});
		},
	});
}

export function useLogoutMutation() {
	const authService = useAuthService();
	const queryClient = useQueryClient();
	const router = useRouter();
	return useMutation({
		mutationFn: () => authService.logout(),
		onSuccess: async () => {
			await queryClient.resetQueries({ queryKey: dashboardQueryKeys.root });
			await router.navigate({ to: "/login" });
		},
	});
}
