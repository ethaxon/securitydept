import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export const AuthEntryKind = {
	Basic: "basic",
	Token: "token",
} as const;

export type AuthEntryKind = (typeof AuthEntryKind)[keyof typeof AuthEntryKind];

export interface AuthEntry {
	id: string;
	name: string;
	kind: AuthEntryKind;
	username?: string;
	group_ids: string[];
	created_at: string;
	updated_at: string;
}

export type CreateBasicEntryResponse = {
	entry: AuthEntry;
};

export type CreateTokenResponse = {
	entry: AuthEntry;
	token: string;
};

export function useEntries() {
	return useQuery<AuthEntry[]>({
		queryKey: ["entries"],
		queryFn: () => api.get("/api/entries"),
	});
}

export function useEntry(id: string) {
	return useQuery<AuthEntry>({
		queryKey: ["entry", id],
		queryFn: () => api.get(`/api/entries/${id}`),
		enabled: Boolean(id),
	});
}

export function useCreateBasicEntry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: {
			name: string;
			username: string;
			password: string;
			group_ids: string[];
		}) => api.post<CreateBasicEntryResponse>("/api/entries/basic", data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["entries"] }),
	});
}

export function useCreateTokenEntry() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { name: string; group_ids: string[] }) =>
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
			group_ids?: string[];
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
