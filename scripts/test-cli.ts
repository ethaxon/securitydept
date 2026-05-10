#!/usr/bin/env node

import { Builtins, Cli, Command, Option } from "clipanion";

import {
	buildKubeTestHelperImage,
	buildKubeTestRuntimeImages,
	cleanKubeTestArtifacts,
	cleanKubeTestImages,
	ensureKubeTestHelperImage,
} from "./lib/kube-test-resources.ts";
import { runKubeRustE2e } from "./lib/kube-test-runner.ts";
import { loadSecuritydeptMetadata } from "./lib/metadata.ts";

class KubeBuildRuntimeImagesCommand extends Command {
	static override paths = [["kube", "build-runtime-images"]];

	async execute(): Promise<number> {
		await buildKubeTestRuntimeImages();
		return 0;
	}
}

class KubeBuildHelperCommand extends Command {
	static override paths = [["kube", "build-helper"]];

	async execute(): Promise<number> {
		await buildKubeTestHelperImage();
		return 0;
	}
}

class KubeEnsureHelperCommand extends Command {
	static override paths = [["kube", "ensure-helper"]];

	async execute(): Promise<number> {
		await ensureKubeTestHelperImage();
		return 0;
	}
}

class KubeRunRustE2eCommand extends Command {
	static override paths = [["kube", "run-e2e-rs"]];

	keepClustersRunning = Option.Boolean("--keep-clusters-running", false);
	reuseClusters = Option.String("--reuse-clusters", "true");

	async execute(): Promise<number> {
		runKubeRustE2e({
			keepClustersRunning: this.keepClustersRunning,
			reuseClusters:
				this.reuseClusters !== "false" && this.reuseClusters !== "0",
		});
		return 0;
	}
}

class KubeCleanArtifactsCommand extends Command {
	static override paths = [["kube", "clean-artifacts"]];

	async execute(): Promise<number> {
		await cleanKubeTestArtifacts();
		return 0;
	}
}

class KubeCleanImagesCommand extends Command {
	static override paths = [["kube", "clean-images"]];

	async execute(): Promise<number> {
		await cleanKubeTestImages();
		return 0;
	}
}

const metadata = loadSecuritydeptMetadata();
const cli = new Cli({
	binaryLabel: "SecurityDept test CLI",
	binaryName: "test-cli",
	binaryVersion: metadata.project.version,
});

cli.register(Builtins.HelpCommand);
cli.register(Builtins.VersionCommand);
cli.register(KubeBuildRuntimeImagesCommand);
cli.register(KubeBuildHelperCommand);
cli.register(KubeEnsureHelperCommand);
cli.register(KubeRunRustE2eCommand);
cli.register(KubeCleanArtifactsCommand);
cli.register(KubeCleanImagesCommand);

await cli.runExit(process.argv.slice(2), Cli.defaultContext);
