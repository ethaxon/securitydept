import type { ChildProcess } from "node:child_process";

export function bindChildProcessLifecycle(childProcess: ChildProcess): void {
	let isShuttingDown = false;

	function shutdown(signal: NodeJS.Signals): void {
		if (isShuttingDown) {
			return;
		}
		isShuttingDown = true;

		const forceKillTimer = setTimeout(() => {
			if (childProcess.exitCode === null && childProcess.signalCode === null) {
				childProcess.kill("SIGKILL");
			}
			setTimeout(() => {
				process.exit(1);
			}, 1_000).unref();
		}, 5_000);
		forceKillTimer.unref();

		if (childProcess.exitCode === null && childProcess.signalCode === null) {
			childProcess.kill(signal);
		}

		childProcess.once("exit", (code) => {
			clearTimeout(forceKillTimer);
			process.exit(code ?? 0);
		});
	}

	process.once("SIGINT", () => shutdown("SIGINT"));
	process.once("SIGTERM", () => shutdown("SIGTERM"));

	childProcess.once("exit", (code) => {
		if (!isShuttingDown) {
			process.exit(code ?? 0);
		}
	});
}
