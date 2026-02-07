import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Save, Users } from "lucide-react";
import { useEntries } from "@/api/entries";
import type { Group } from "@/api/groups";
import { useCreateGroup, useUpdateGroup } from "@/api/groups";

interface GroupFormProps {
	mode: "create" | "edit";
	group?: Group;
}

function sortedUnique(ids: string[]) {
	return Array.from(new Set(ids)).sort();
}

export function GroupForm({ mode, group }: GroupFormProps) {
	const navigate = useNavigate();
	const isEdit = mode === "edit";
	const createGroup = useCreateGroup();
	const updateGroup = useUpdateGroup();
	const { data: entries = [] } = useEntries();

	const initialEntryIds = isEdit
		? entries
				.filter((entry) => entry.group_ids.includes(group?.id ?? ""))
				.map((entry) => entry.id)
		: [];

	const form = useForm({
		defaultValues: {
			name: group?.name ?? "",
			entry_ids: initialEntryIds,
		},
		onSubmit: async ({ value }) => {
			const entryIds = sortedUnique(value.entry_ids);
			if (isEdit) {
				if (!group) return;
				await updateGroup.mutateAsync({
					id: group.id,
					name: value.name,
					entry_ids: entryIds,
				});
			} else {
				await createGroup.mutateAsync({
					name: value.name,
					entry_ids: entryIds,
				});
			}
			await navigate({ to: "/groups" });
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				e.stopPropagation();
				void form.handleSubmit();
			}}
			className="space-y-4"
		>
			{isEdit && group ? (
				<div className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
					ID: {group.id}
				</div>
			) : null}

			<form.Field name="name">
				{(field) => (
					<input
						type="text"
						placeholder="Group name"
						value={field.state.value}
						onChange={(e) => field.handleChange(e.target.value)}
						required
						className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
					/>
				)}
			</form.Field>

			<div>
				<p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
					Auth Entries
				</p>
				<form.Field name="entry_ids">
					{(field) => (
						<div className="flex flex-wrap gap-2">
							{entries.map((entry) => (
								<button
									key={entry.id}
									type="button"
									onClick={() => {
										const current = field.state.value;
										const next = current.includes(entry.id)
											? current.filter((id) => id !== entry.id)
											: [...current, entry.id];
										field.handleChange(next);
									}}
									className={`rounded-md px-2.5 py-1 text-xs font-medium ${
										field.state.value.includes(entry.id)
											? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
											: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
									}`}
								>
									{entry.name}
								</button>
							))}
							{entries.length === 0 ? (
								<span className="text-xs text-zinc-400">
									No auth entries yet.
								</span>
							) : null}
						</div>
					)}
				</form.Field>
			</div>

			<button
				type="submit"
				disabled={createGroup.isPending || updateGroup.isPending}
				className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
			>
				{isEdit ? <Save className="h-4 w-4" /> : <Users className="h-4 w-4" />}
				{isEdit ? "Save Changes" : "Create Group"}
			</button>
		</form>
	);
}
