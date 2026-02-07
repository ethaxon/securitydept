import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Copy, KeyRound } from "lucide-react";
import { useState } from "react";
import {
	type AuthEntry,
	type CreateTokenResponse,
	useCreateBasicEntry,
	useCreateTokenEntry,
	useUpdateEntry,
} from "@/api/entries";
import { useGroups } from "@/api/groups";
import type { EntrySearch } from "@/routes/entrySearch";

interface EntryFormProps {
	mode: "create" | "edit";
	entry?: AuthEntry;
	initial?: EntrySearch;
}

export function EntryForm({ mode, entry, initial }: EntryFormProps) {
	const navigate = useNavigate();
	const isEdit = mode === "edit";
	const [generatedToken, setGeneratedToken] = useState<string | null>(null);

	const { data: groups = [] } = useGroups();
	const createBasic = useCreateBasicEntry();
	const createToken = useCreateTokenEntry();
	const updateEntry = useUpdateEntry();

	const form = useForm({
		defaultValues: {
			kind: isEdit ? (entry?.kind ?? "basic") : (initial?.kind ?? "basic"),
			name: isEdit
				? (initial?.name ?? entry?.name ?? "")
				: (initial?.name ?? ""),
			username: isEdit
				? (initial?.username ?? entry?.username ?? "")
				: (initial?.username ?? ""),
			password: "",
			group_ids: initial?.group_ids ?? (isEdit ? (entry?.group_ids ?? []) : []),
		},
		onSubmit: async ({ value }) => {
			if (isEdit) {
				if (!entry) return;
				await updateEntry.mutateAsync({
					id: entry.id,
					name: value.name,
					username: entry.kind === "basic" ? value.username : undefined,
					password:
						entry.kind === "basic" && value.password.trim().length > 0
							? value.password
							: undefined,
					group_ids: value.group_ids,
				});
				await navigate({ to: "/entries" });
				return;
			}

			setGeneratedToken(null);
			if (value.kind === "basic") {
				await createBasic.mutateAsync({
					name: value.name,
					username: value.username,
					password: value.password,
					group_ids: value.group_ids,
				});
				form.reset({
					kind: value.kind,
					name: "",
					username: "",
					password: "",
					group_ids: [],
				});
				return;
			}

			const result: CreateTokenResponse = await createToken.mutateAsync({
				name: value.name,
				group_ids: value.group_ids,
			});
			setGeneratedToken(result.token);
			form.reset({
				kind: value.kind,
				name: "",
				username: "",
				password: "",
				group_ids: [],
			});
		},
	});

	return (
		<div className="space-y-4">
			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="space-y-4"
			>
				<form.Field name="kind">
					{(field) => (
						<div className="flex flex-wrap gap-2">
							{isEdit ? (
								<>
									<span className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
										ID: {entry?.id}
									</span>
									<span className="rounded-md bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-600 capitalize dark:bg-zinc-800 dark:text-zinc-300">
										Type: {entry?.kind}
									</span>
								</>
							) : (
								<>
									<button
										type="button"
										onClick={() => field.handleChange("basic")}
										className={`rounded-md px-3 py-1.5 text-sm font-medium ${field.state.value === "basic" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
									>
										Basic Auth
									</button>
									<button
										type="button"
										onClick={() => field.handleChange("token")}
										className={`rounded-md px-3 py-1.5 text-sm font-medium ${field.state.value === "token" ? "bg-blue-600 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
									>
										Token Auth
									</button>
								</>
							)}
						</div>
					)}
				</form.Field>

				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
					<form.Field name="name">
						{(field) => (
							<input
								type="text"
								placeholder="Entry name"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								required
								className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
							/>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values.kind}>
						{(kind) =>
							kind === "basic" && (
								<>
									<form.Field name="username">
										{(field) => (
											<input
												type="text"
												placeholder="Username"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												required
												className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
											/>
										)}
									</form.Field>
									<form.Field name="password">
										{(field) => (
											<input
												type="password"
												placeholder={
													isEdit
														? "New password (leave empty to keep)"
														: "Password"
												}
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												required={!isEdit}
												className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
											/>
										)}
									</form.Field>
								</>
							)
						}
					</form.Subscribe>
				</div>

				<div>
					<p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
						Groups
					</p>
					<form.Field name="group_ids">
						{(field) => (
							<div className="flex flex-wrap gap-2">
								{groups.map((g) => (
									<button
										key={g.id}
										type="button"
										onClick={() => {
											const current = field.state.value;
											const next = current.includes(g.id)
												? current.filter((id) => id !== g.id)
												: [...current, g.id];
											field.handleChange(next);
										}}
										className={`rounded-md px-2.5 py-1 text-xs font-medium ${
											field.state.value.includes(g.id)
												? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
												: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
										}`}
									>
										{g.name}
									</button>
								))}
								{groups.length === 0 && (
									<span className="text-xs text-zinc-400">
										No groups yet. Create groups first.
									</span>
								)}
							</div>
						)}
					</form.Field>
				</div>

				<button
					type="submit"
					disabled={
						createBasic.isPending ||
						createToken.isPending ||
						updateEntry.isPending
					}
					className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:w-auto"
				>
					<KeyRound className="h-4 w-4" />
					{isEdit ? "Save Changes" : "Create Entry"}
				</button>
			</form>

			{!isEdit && generatedToken && (
				<div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
					<p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
						Token generated (save it now, it won't be shown again):
					</p>
					<div className="flex items-center gap-2">
						<code className="flex-1 rounded bg-white px-3 py-2 text-sm break-all dark:bg-zinc-900">
							{generatedToken}
						</code>
						<button
							type="button"
							onClick={() => navigator.clipboard.writeText(generatedToken)}
							className="rounded-md p-2 hover:bg-amber-100 dark:hover:bg-amber-900"
						>
							<Copy className="h-4 w-4" />
						</button>
					</div>
					<button
						type="button"
						onClick={() => setGeneratedToken(null)}
						className="mt-2 text-xs text-amber-700 underline dark:text-amber-400"
					>
						Dismiss
					</button>
				</div>
			)}
		</div>
	);
}
