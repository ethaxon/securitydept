#!/usr/bin/env node

import { Builtins, Cli, Command, Option } from "clipanion";

import { runCratesPublish } from "./lib/crates-release.ts";
import { runDockerPublish } from "./lib/docker-release.ts";
import { loadSecuritydeptMetadata } from "./lib/metadata.ts";
import { runMetadataSync } from "./lib/metadata-sync.ts";
import { runNpmPublish } from "./lib/npm-release.ts";
import {
	ReleaseRefValidationKind,
	runEnsureReleaseTag,
	runValidateReleaseRef,
} from "./lib/release-ref.ts";
import {
	ensureVersionConsistency,
	setWorkspaceVersion,
} from "./lib/version.ts";
import {
	type GithubOutputFormat,
	runReleasePlan,
	runTestsPreflight,
} from "./lib/workflow.ts";

class VersionSetCommand extends Command {
	static override paths = [["version", "set"]];

	version = Option.String();

	async execute(): Promise<number> {
		setWorkspaceVersion(this.version);
		return 0;
	}
}

class VersionCheckCommand extends Command {
	static override paths = [["version", "check"]];

	async execute(): Promise<number> {
		ensureVersionConsistency();
		return 0;
	}
}

class MetadataSyncCommand extends Command {
	static override paths = [["metadata", "sync"]];

	scope = Option.String("--scope", "all");

	async execute(): Promise<number> {
		runMetadataSync({
			scope: this.scope === "rust" || this.scope === "npm" ? this.scope : "all",
		});
		return 0;
	}
}

class NpmPublishCommand extends Command {
	static override paths = [["npm", "publish"]];

	mode = Option.String("--mode", "dry-run");
	tag = Option.String("--tag");
	provenance = Option.Boolean("--provenance", false);
	packDestination = Option.String("--pack-destination");
	report = Option.String("--report");

	async execute(): Promise<number> {
		await runNpmPublish({
			mode: this.mode === "publish" ? "publish" : "dry-run",
			tag: this.tag,
			provenance: this.provenance,
			packDestination: this.packDestination,
			reportPath: this.report,
		});
		return 0;
	}
}

class CratesPublishCommand extends Command {
	static override paths = [["crates", "publish"]];

	mode = Option.String("--mode", "package");
	allowBlocked = Option.Boolean("--allow-blocked", false);
	allowDirty = Option.Boolean("--allow-dirty", false);
	report = Option.String("--report");

	async execute(): Promise<number> {
		await runCratesPublish({
			mode: this.mode === "publish" ? "publish" : "package",
			allowBlocked: this.allowBlocked,
			allowDirty: this.allowDirty,
			reportPath: this.report,
		});
		return 0;
	}
}

class DockerPublishCommand extends Command {
	static override paths = [["docker", "publish"]];

	ref = Option.String("--ref");
	sha = Option.String("--sha");
	image = Option.String("--image");
	revision = Option.String("--revision");
	sourceUrl = Option.String("--source-url");
	format = Option.String("--format", "human");
	githubOutputPath = Option.String("--github-output-path");

	async execute(): Promise<number> {
		runDockerPublish({
			ref: this.ref,
			sha: this.sha,
			image: this.image,
			revision: this.revision,
			sourceUrl: this.sourceUrl,
			format:
				this.format === "json" || this.format === "github-output"
					? this.format
					: "human",
			githubOutputPath: this.githubOutputPath,
		});
		return 0;
	}
}

class ValidateReleaseRefCommand extends Command {
	static override paths = [["workflow", "validate-release-ref"]];

	kind = Option.String("--kind", ReleaseRefValidationKind.Release);
	mode = Option.String("--mode", "publish");
	publishMode = Option.String("--publish-mode", "publish");
	ref = Option.String("--ref");
	refName = Option.String("--ref-name");
	sha = Option.String("--sha");
	releaseBranch = Option.String("--release-branch", "release");
	format = Option.String("--format", "human");
	githubOutputPath = Option.String("--github-output-path");

	async execute(): Promise<number> {
		runValidateReleaseRef({
			kind:
				this.kind === ReleaseRefValidationKind.Npm ||
				this.kind === ReleaseRefValidationKind.Crates
					? this.kind
					: ReleaseRefValidationKind.Release,
			mode: this.mode,
			publishMode: this.publishMode,
			ref: this.ref,
			refName: this.refName,
			releaseBranch: this.releaseBranch,
			sha: this.sha,
			format: this.format === "github-output" ? "github-output" : "human",
			githubOutputPath: this.githubOutputPath,
		});
		return 0;
	}
}

class EnsureReleaseTagCommand extends Command {
	static override paths = [["workflow", "ensure-release-tag"]];

	ref = Option.String("--ref");
	refName = Option.String("--ref-name");
	sha = Option.String("--sha");
	releaseBranch = Option.String("--release-branch", "release");
	push = Option.Boolean("--push", false);

	async execute(): Promise<number> {
		runEnsureReleaseTag({
			ref: this.ref,
			refName: this.refName,
			releaseBranch: this.releaseBranch,
			sha: this.sha,
			push: this.push,
		});
		return 0;
	}
}

class WorkflowTestsPreflightCommand extends Command {
	static override paths = [["workflow", "tests-preflight"]];

	workflowFile = Option.String("--workflow-file", "tests.yml");
	report = Option.String("--report", "temp/release/tests/report.json");
	format = Option.String("--format", "human");
	githubOutputPath = Option.String("--github-output-path");
	repository = Option.String("--repository");
	githubToken = Option.String("--github-token");
	runId = Option.String("--run-id");
	eventName = Option.String("--event-name");
	eventPath = Option.String("--event-path");
	ref = Option.String("--ref");
	sha = Option.String("--sha");

	async execute(): Promise<number> {
		await runTestsPreflight({
			workflowFile: this.workflowFile,
			reportPath: this.report,
			format: normalizeOutputFormat(this.format),
			githubOutputPath: this.githubOutputPath,
			repository: this.repository,
			githubToken: this.githubToken,
			runId: this.runId,
			eventName: this.eventName,
			eventPath: this.eventPath,
			ref: this.ref,
			sha: this.sha,
		});
		return 0;
	}
}

class WorkflowReleasePlanCommand extends Command {
	static override paths = [["workflow", "release-plan"]];

	report = Option.String("--report", "temp/release/release-plan.json");
	format = Option.String("--format", "human");
	githubOutputPath = Option.String("--github-output-path");
	eventName = Option.String("--event-name");
	eventPath = Option.String("--event-path");
	sourceRef = Option.String("--source-ref");
	sourceSha = Option.String("--source-sha");
	publishNpm = Option.String("--publish-npm", "auto");
	publishCrates = Option.String("--publish-crates", "auto");
	publishDocker = Option.String("--publish-docker", "auto");
	localRun = Option.String("--local-run", "auto");
	releaseBranch = Option.String("--release-branch", "release");

	async execute(): Promise<number> {
		runReleasePlan({
			reportPath: this.report,
			format: normalizeOutputFormat(this.format),
			githubOutputPath: this.githubOutputPath,
			eventName: this.eventName,
			eventPath: this.eventPath,
			sourceRef: this.sourceRef,
			sourceSha: this.sourceSha,
			publishNpm: this.publishNpm,
			publishCrates: this.publishCrates,
			publishDocker: this.publishDocker,
			localRun: this.localRun,
			releaseBranch: this.releaseBranch,
		});
		return 0;
	}
}

function normalizeOutputFormat(format: string): GithubOutputFormat {
	return format === "github-output" || format === "json" ? format : "human";
}

const metadata = loadSecuritydeptMetadata();
const cli = new Cli({
	binaryLabel: "SecurityDept release CLI",
	binaryName: "release-cli",
	binaryVersion: metadata.project.version,
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(VersionSetCommand);
cli.register(VersionCheckCommand);
cli.register(MetadataSyncCommand);
cli.register(NpmPublishCommand);
cli.register(CratesPublishCommand);
cli.register(DockerPublishCommand);
cli.register(ValidateReleaseRefCommand);
cli.register(EnsureReleaseTagCommand);
cli.register(WorkflowTestsPreflightCommand);
cli.register(WorkflowReleasePlanCommand);

await cli.runExit(process.argv.slice(2), Cli.defaultContext);
