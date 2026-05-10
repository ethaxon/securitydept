#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { Builtins, Cli, Command, Option } from "clipanion";

import { loadSecuritydeptMetadata } from "./lib/metadata.ts";
import { runCommand } from "./lib/process.ts";

const releaseWorkflowPath = ".github/workflows/release.yml";
const shorthandOptions = new Map([
	["source_ref", "source-ref"],
	["source_sha", "source-sha"],
	["publish_npm", "publish-npm"],
	["publish_crates", "publish-crates"],
	["publish_docker", "publish-docker"],
]);

class ReleaseValidateCommand extends Command {
	static override paths = [["release", "validate"]];

	async execute(): Promise<number> {
		runCommand("act", ["--validate", "-W", releaseWorkflowPath]);
		return 0;
	}
}

class ReleaseDispatchCommand extends Command {
	static override paths = [["release", "dispatch"]];

	dryRun = Option.Boolean("--dry-run", false);
	sourceRef = Option.String("--source-ref", "refs/heads/release");
	sourceSha = Option.String("--source-sha");
	publishNpm = Option.String("--publish-npm", "false");
	publishCrates = Option.String("--publish-crates", "false");
	publishDocker = Option.String("--publish-docker", "false");

	async execute(): Promise<number> {
		if (this.dryRun) {
			runReleaseDispatchDryRun({
				sourceRef: this.sourceRef,
				sourceSha: this.sourceSha,
				publishNpm: this.publishNpm,
				publishCrates: this.publishCrates,
				publishDocker: this.publishDocker,
			});
			return 0;
		}

		this.context.stderr.write(
			"`just action-release-run` is temporarily disabled because the act-js dependency has been removed. Use `just action-release-dry-run` for now; full local workflow execution will return with pretend-act.\n",
		);
		return 1;
	}
}

type ReleaseDispatchOptions = {
	sourceRef?: string;
	sourceSha?: string;
	publishNpm?: string;
	publishCrates?: string;
	publishDocker?: string;
};

function runReleaseDispatchDryRun(options: ReleaseDispatchOptions): void {
	const resolvedSourceSha = resolveSourceSha(options.sourceSha);
	runCommand("act", [
		"workflow_dispatch",
		"-W",
		releaseWorkflowPath,
		"-n",
		...releaseInputArgs(options, resolvedSourceSha),
	]);
}

function releaseInputArgs(
	options: ReleaseDispatchOptions,
	resolvedSourceSha: string,
): string[] {
	return [
		"--input",
		`source_ref=${normalizeInput(options.sourceRef) ?? "refs/heads/release"}`,
		"--input",
		`source_sha=${resolvedSourceSha}`,
		"--input",
		`publish_npm=${normalizeInput(options.publishNpm) ?? "false"}`,
		"--input",
		`publish_crates=${normalizeInput(options.publishCrates) ?? "false"}`,
		"--input",
		`publish_docker=${normalizeInput(options.publishDocker) ?? "false"}`,
	];
}

function normalizeInput(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized ? normalized : undefined;
}

function resolveSourceSha(sourceSha: string | undefined): string {
	const normalizedSourceSha = normalizeInput(sourceSha);
	if (normalizedSourceSha) {
		return normalizedSourceSha;
	}

	return readGitStdout(["rev-parse", "HEAD"], process.cwd());
}

function readGitStdout(args: string[], cwd: string): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});

	if (result.status !== 0) {
		throw new Error(
			`Command failed: git ${args.join(" ")} (${result.status ?? "unknown"})`,
		);
	}

	const stdout = result.stdout.trim();
	if (!stdout) {
		throw new Error(`git ${args.join(" ")} returned empty output`);
	}

	return stdout;
}

function normalizeShorthandArgs(args: string[]): string[] {
	return args.map((arg) => {
		const separatorIndex = arg.indexOf("=");
		if (arg.startsWith("--") || separatorIndex === -1) {
			return arg;
		}

		const key = arg.slice(0, separatorIndex);
		const normalizedKey = shorthandOptions.get(key);
		if (!normalizedKey) {
			return arg;
		}

		return `--${normalizedKey}=${arg.slice(separatorIndex + 1)}`;
	});
}

const metadata = loadSecuritydeptMetadata();
const cli = new Cli({
	binaryLabel: "SecurityDept actions CLI",
	binaryName: "actions-cli",
	binaryVersion: metadata.project.version,
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(ReleaseValidateCommand);
cli.register(ReleaseDispatchCommand);

await cli.runExit(
	normalizeShorthandArgs(process.argv.slice(2)),
	Cli.defaultContext,
);
