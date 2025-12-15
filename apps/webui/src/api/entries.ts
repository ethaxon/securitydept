import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface AuthEntry {
	id: string;
	name: string;
	kind: "basic" | "token";
	username?: string;
	groups: string[];
	created_at: string;
	updated_at: string;
}

export interface CreateTokenResponse {
	entry: AuthEntry;
	token: string;
}

export function useEntries() {
	return useQuery<AuthEntry[]>({
		queryKey: ["entries"],
		queryFn: () => api.get("/api/entries"),
	});
}

export function useCreateBasicEntry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: {
			name: string;
			username: string;
			password: string;
			groups: string[];
		}) => api.post<AuthEntry>("/api/entries/basic", data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["entries"] }),
	});
}

export function useCreateTokenEntry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { name: string; groups: string[] }) =>
			api.post<CreateTokenResponse>("/api/entries/token", data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["entries"] }),
	});
}

export function useUpdateEntry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			...data
		}: {
			id: string;
			name?: string;
			username?: string;
			password?: string;
			groups?: string[];
		}) => api.put<AuthEntry>(`/api/entries/${id}`, data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["entries"] }),
	});
}

export function useDeleteEntry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.delete(`/api/entries/${id}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["entries"] }),
	});
}
