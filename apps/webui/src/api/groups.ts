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

export function useCreateGroup() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (data: { name: string }) =>
			api.post<Group>("/api/groups", data),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
	});
}

export function useUpdateGroup() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, name }: { id: string; name: string }) =>
			api.put<Group>(`/api/groups/${id}`, { name }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
	});
}

export function useDeleteGroup() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => api.delete(`/api/groups/${id}`),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
	});
}
