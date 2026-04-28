#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import path from "node:path";

import { Builtins, Cli, Command, Option } from "clipanion";

import { loadSecuritydeptMetadata } from "./lib/metadata.ts";
import { runCommand } from "./lib/process.ts";

const releaseWorkflowPath = ".github/workflows/release.yml";
const mockRepoName = "securitydept";
const mockRootPath = path.resolve("temp", "actions-cli");
const neverCondition = "$" + "{{ false }}";
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

		await runReleaseDispatch({
			sourceRef: this.sourceRef,
			sourceSha: this.sourceSha,
			publishNpm: this.publishNpm,
			publishCrates: this.publishCrates,
			publishDocker: this.publishDocker,
		});
		return 0;
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

async function runReleaseDispatch(
	options: ReleaseDispatchOptions,
): Promise<void> {
	process.env.ACT_BINARY ??= "act";

	const [{ Act }, { MockGithub }] = await Promise.all([
		import("@kie/act-js"),
		import("@kie/mock-github"),
	]);

	mkdirSync(mockRootPath, { recursive: true });
	const setupPath = mkdtempSync(path.join(mockRootPath, "mock-github-"));
	const stagingPath = mkdtempSync(path.join(mockRootPath, "workspace-"));
	const logFile = path.join(mockRootPath, "act-release-run.log");
	copyWorkspaceToStaging(stagingPath);
	let removeMockRoot = false;

	const github = new MockGithub(
		{
			repo: {
				[mockRepoName]: {
					files: [
						{
							src: stagingPath,
							dest: ".",
						},
					],
				},
			},
		},
		setupPath,
	);

	try {
		await github.setup();
		const repoPath = github.repo.getPath(mockRepoName);
		if (!repoPath) {
			throw new Error(`Mock repository '${mockRepoName}' was not created.`);
		}

		const resolvedSourceSha =
			normalizeInput(options.sourceSha) ??
			readGitStdout(["rev-parse", "HEAD"], repoPath);
		const workflowReportPath = path.join(
			repoPath,
			"temp",
			"release",
			"release-workflow-report.json",
		);
		const act = new Act(repoPath, path.join(repoPath, releaseWorkflowPath));

		act.setEnv("SECURITYDEPT_LOCAL_ACTIONS", "true");
		act.setCustomContainerOpts(resolveContainerUserOption());
		act.setInput(
			"source_ref",
			normalizeInput(options.sourceRef) ?? "refs/heads/release",
		);
		act.setInput("source_sha", resolvedSourceSha);
		act.setInput("publish_npm", normalizeInput(options.publishNpm) ?? "false");
		act.setInput(
			"publish_crates",
			normalizeInput(options.publishCrates) ?? "false",
		);
		act.setInput(
			"publish_docker",
			normalizeInput(options.publishDocker) ?? "false",
		);

		await act.runEvent("workflow_dispatch", {
			cwd: repoPath,
			workflowFile: path.join(repoPath, releaseWorkflowPath),
			bind: true,
			logFile,
			mockSteps: mockLocalOnlySteps(),
		});

		if (!existsSync(workflowReportPath)) {
			throw new Error(
				`Local release workflow did not create ${workflowReportPath}. Raw act log: ${logFile}`,
			);
		}

		const rawLog = readFileSync(logFile, "utf8");
		if (rawLog.includes("🏁  Job failed") || rawLog.includes("exitcode '")) {
			throw new Error(`Local release workflow failed. Raw act log: ${logFile}`);
		}

		console.log("Local release workflow completed in MockGithub workspace.");
		removeMockRoot = true;
	} finally {
		await github.teardown();
		rmSync(stagingPath, { recursive: true, force: true });
		rmSync(setupPath, { recursive: true, force: true });
		if (removeMockRoot) {
			rmSync(mockRootPath, { recursive: true, force: true });
		}
	}
}

function copyWorkspaceToStaging(stagingPath: string): void {
	const workspacePath = process.cwd();
	copyFilteredPath(workspacePath, stagingPath, workspacePath);
}

function copyFilteredPath(
	sourcePath: string,
	destinationPath: string,
	workspacePath: string,
): void {
	if (!shouldCopyWorkspacePath(workspacePath, sourcePath)) {
		return;
	}

	const sourceStat = statSync(sourcePath);
	if (sourceStat.isDirectory()) {
		mkdirSync(destinationPath, { recursive: true });
		for (const entry of readdirSync(sourcePath)) {
			copyFilteredPath(
				path.join(sourcePath, entry),
				path.join(destinationPath, entry),
				workspacePath,
			);
		}
		return;
	}

	mkdirSync(path.dirname(destinationPath), { recursive: true });
	copyFileSync(sourcePath, destinationPath);
}

function shouldCopyWorkspacePath(
	workspacePath: string,
	sourcePath: string,
): boolean {
	const relativePath = path.relative(workspacePath, sourcePath);
	if (!relativePath) {
		return true;
	}

	const normalizedPath = relativePath.split(path.sep).join("/");
	const [rootEntry] = normalizedPath.split("/");
	if (
		rootEntry === ".git" ||
		rootEntry === "node_modules" ||
		rootEntry === "target" ||
		rootEntry === "dist-tsc"
	) {
		return false;
	}

	return !(
		normalizedPath.includes("/node_modules/") ||
		normalizedPath.includes("/dist-tsc/") ||
		normalizedPath === "temp/actions-cli" ||
		normalizedPath.startsWith("temp/actions-cli/") ||
		normalizedPath === "docsite/.vitepress/cache" ||
		normalizedPath.startsWith("docsite/.vitepress/cache/")
	);
}

function resolveContainerUserOption(): string | undefined {
	if (
		typeof process.getuid !== "function" ||
		typeof process.getgid !== "function"
	) {
		return undefined;
	}

	return `--user ${process.getuid()}:${process.getgid()}`;
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

function mockLocalOnlySteps(): Record<
	string,
	{
		uses: string;
		mockWith: { if: string };
	}[]
> {
	const checkoutMock = {
		uses: "actions/checkout@v6",
		mockWith: { if: neverCondition },
	};
	const uploadArtifactMock = {
		uses: "actions/upload-artifact@v7",
		mockWith: { if: neverCondition },
	};

	return {
		"release-plan": [checkoutMock, uploadArtifactMock],
		"rust-release-cache-prime": [checkoutMock],
		"npm-release": [checkoutMock, uploadArtifactMock],
		"crates-release": [checkoutMock, uploadArtifactMock],
		"docker-release": [checkoutMock, uploadArtifactMock],
		"release-report": [uploadArtifactMock],
	};
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
