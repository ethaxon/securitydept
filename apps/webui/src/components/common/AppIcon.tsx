import { cn } from "@/lib/utils";

export function AppIcon({ className }: { className?: string }) {
	return (
		<div
			className={cn(
				"inline-flex items-center justify-center rounded-[24%] border border-white/35 bg-white/40 p-1 shadow-[0_8px_24px_rgba(15,23,42,0.15)] backdrop-blur-xl dark:border-zinc-200/10 dark:bg-zinc-800/35 dark:shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
				className,
			)}
		>
			<img
				src="/icon-128.png"
				alt="SecurityDept"
				className="h-full w-full rounded-[20%] object-contain"
			/>
		</div>
	);
}
