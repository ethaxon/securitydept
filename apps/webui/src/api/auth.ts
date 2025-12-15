import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface UserInfo {
	display_name: string;
	claims: Record<string, unknown>;
}

export function useMe() {
	return useQuery<UserInfo>({
		queryKey: ["auth", "me"],
		queryFn: () => api.get("/auth/me"),
		retry: false,
	});
}

export function useLogout() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => api.post("/auth/logout", {}),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["auth"] });
			window.location.href = "/login";
		},
	});
}
