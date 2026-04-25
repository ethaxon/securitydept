#!/usr/bin/env node

import { Builtins, Cli, Command, Option } from "clipanion";

import { runCratesPublish } from "./lib/crates-release.ts";
import { runDockerPublish } from "./lib/docker-release.ts";
import { loadSecuritydeptMetadata } from "./lib/metadata.ts";
import { runMetadataSync } from "./lib/metadata-sync.ts";
import { runNpmPublish } from "./lib/npm-release.ts";
import {
	ensureVersionConsistency,
	setWorkspaceVersion,
} from "./lib/version.ts";

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

	async execute(): Promise<number> {
		runNpmPublish({
			mode: this.mode === "publish" ? "publish" : "dry-run",
			tag: this.tag,
			provenance: this.provenance,
			packDestination: this.packDestination,
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
		runCratesPublish({
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

await cli.runExit(process.argv.slice(2), Cli.defaultContext);
