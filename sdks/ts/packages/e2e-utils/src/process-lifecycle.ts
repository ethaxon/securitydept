import type { ChildProcess } from "node:child_process";

export function bindChildProcessLifecycle(childProcess: ChildProcess): void {
	function shutdown(signal: NodeJS.Signals): void {
		if (!childProcess.killed) {
			childProcess.kill(signal);
		}
	}

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));

	childProcess.on("exit", (code) => {
		process.exit(code ?? 0);
	});
}
