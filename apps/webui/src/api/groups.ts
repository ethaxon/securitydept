import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export interface Group {
	id: string;
	name: string;
}

export function useGroups() {
	return useQuery<Group[]>({
		queryKey: ["groups"],
		queryFn: () => api.get("/api/groups"),
	});
}

export function useGroup(id: string) {
	return useQuery<Group>({
		queryKey: ["group", id],
		queryFn: () => api.get(`/api/groups/${id}`),
		enabled: Boolean(id),
	});
}

export function useCreateGroup() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { name: string; entry_ids?: string[] }) =>
			api.post<Group>("/api/groups", data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["groups"] });
			qc.invalidateQueries({ queryKey: ["entries"] });
		},
	});
}

export function useUpdateGroup() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			name,
			entry_ids,
		}: {
			id: string;
			name: string;
			entry_ids?: string[];
		}) => api.put<Group>(`/api/groups/${id}`, { name, entry_ids }),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["groups"] });
			qc.invalidateQueries({ queryKey: ["entries"] });
			qc.invalidateQueries({ queryKey: ["group"] });
		},
	});
}

export function useDeleteGroup() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.delete(`/api/groups/${id}`),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["groups"] });
			qc.invalidateQueries({ queryKey: ["entries"] });
		},
	});
}
