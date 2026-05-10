import { runCommand } from "./process.ts";

type RunKubeRustE2eOptions = {
	keepClustersRunning: boolean;
	reuseClusters: boolean;
};

export function runKubeRustE2e(options: RunKubeRustE2eOptions): void {
	runCommand(
		"cargo",
		["test", "--workspace", "--test", "e2e", "--all-features"],
		{
			env: {
				SECURITYDEPT_REALIP_E2E_KEEP_CLUSTERS_RUNNING:
					options.keepClustersRunning ? "1" : "0",
				SECURITYDEPT_REALIP_E2E_REUSE_CLUSTERS: options.reuseClusters
					? "1"
					: "0",
			},
		},
	);
}
