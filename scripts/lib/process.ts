import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

type CommandOptions = {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	createParentDirectoryFor?: string;
};

export function runCommand(
	command: string,
	args: string[],
	options: CommandOptions = {},
): void {
	if (options.createParentDirectoryFor) {
		mkdirSync(path.dirname(options.createParentDirectoryFor), {
			recursive: true,
		});
	}

	const result = spawnSync(command, args, {
		cwd: options.cwd,
		env: {
			...process.env,
			...options.env,
		},
		stdio: "inherit",
	});

	if (result.status !== 0) {
		throw new Error(
			`Command failed: ${command} ${args.join(" ")} (${result.status ?? "unknown"})`,
		);
	}
}
