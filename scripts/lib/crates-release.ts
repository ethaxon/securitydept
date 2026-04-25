import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadSecuritydeptMetadata } from "./metadata.ts";
import { resolveFromRoot } from "./paths.ts";
import { runCommand } from "./process.ts";
import { ensureVersionConsistency } from "./version.ts";

export type CratesPublishOptions = {
	mode: "package" | "publish";
	allowBlocked: boolean;
	allowDirty: boolean;
	reportPath?: string;
};

type CrateReportEntry = {
	name: string;
	manifest: string;
	mode: "package" | "publish";
	status: "ok" | "failed";
	error?: string;
};

export function runCratesPublish(options: CratesPublishOptions): void {
	ensureVersionConsistency();

	const metadata = loadSecuritydeptMetadata();
	const cratesToProcess = metadata.rustPackages.filter((pkg) => pkg.publish);
	const skippedCrates = metadata.rustPackages.filter((pkg) => !pkg.publish);
	const reportPath = resolveFromRoot(
		options.reportPath ??
			(options.mode === "package"
				? metadata.crates.packageReport
				: metadata.crates.publishReport),
	);
	const reportEntries: CrateReportEntry[] = [];

	for (const pkg of skippedCrates) {
		console.log(
			`Skipping ${pkg.name} (${pkg.manifest}) because publish=false.`,
		);
	}

	for (const pkg of cratesToProcess) {
		const crateDirectory = path.dirname(resolveFromRoot(pkg.manifest));
		const cargoArgs = [options.mode];
		if (options.allowDirty) {
			cargoArgs.push("--allow-dirty");
		}
		console.log(`Running cargo ${options.mode} for ${pkg.name}.`);

		try {
			runCommand("cargo", cargoArgs, { cwd: crateDirectory });
			reportEntries.push({
				name: pkg.name,
				manifest: pkg.manifest,
				mode: options.mode,
				status: "ok",
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			reportEntries.push({
				name: pkg.name,
				manifest: pkg.manifest,
				mode: options.mode,
				status: "failed",
				error: message,
			});

			if (!options.allowBlocked) {
				writeCrateReport(reportPath, reportEntries);
				throw error;
			}
		}
	}

	writeCrateReport(reportPath, reportEntries);

	const failedEntries = reportEntries.filter(
		(entry) => entry.status === "failed",
	);
	if (failedEntries.length > 0 && options.allowBlocked) {
		console.warn(
			`${failedEntries.length} crate operations failed; see ${path.relative(resolveFromRoot("."), reportPath)} for details.`,
		);
		return;
	}

	console.log(
		`${options.mode} completed for ${cratesToProcess.length} publishable Rust crates.`,
	);
}

function writeCrateReport(
	reportPath: string,
	entries: CrateReportEntry[],
): void {
	mkdirSync(path.dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(entries, null, 2)}\n`);
}
