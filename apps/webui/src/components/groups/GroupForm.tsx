import { Plus } from "lucide-react";
import { useState } from "react";
import { useCreateGroup } from "@/api/groups";

export function GroupForm() {
	const [name, setName] = useState("");
	const createGroup = useCreateGroup();

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		await createGroup.mutateAsync({ name });
		setName("");
	};

	return (
		<form onSubmit={handleSubmit} className="flex gap-3">
			<input
				type="text"
				placeholder="Group name"
				value={name}
				onChange={(e) => setName(e.target.value)}
				required
				className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
			/>
			<button
				type="submit"
				disabled={createGroup.isPending}
				className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
			>
				<Plus className="h-4 w-4" />
				Create Group
			</button>
		</form>
	);
}
