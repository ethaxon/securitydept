import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const SECURITYDEPT_SKIP_TURBO_PREREQUISITES =
	"SECURITYDEPT_SKIP_TURBO_PREREQUISITES";

export interface RunTurboPrerequisitesOptions {
	readonly workspaceRoot: string;
	readonly packageRoot: string;
	readonly includeSelf: boolean;
}

interface WorkspacePackageManifest {
	readonly name?: string;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
}

const prerequisiteBuilds = new Map<string, Promise<void>>();

export async function runTurboPrerequisites(
	options: RunTurboPrerequisitesOptions,
): Promise<void> {
	if (
		process.env.TURBO_HASH !== undefined ||
		process.env[SECURITYDEPT_SKIP_TURBO_PREREQUISITES] === "1"
	) {
		return;
	}

	const packageRoot = path.resolve(options.packageRoot);
	const manifest = JSON.parse(
		await readFile(path.join(packageRoot, "package.json"), "utf8"),
	) as WorkspacePackageManifest;
	if (manifest.name === undefined) {
		throw new Error(`Workspace package at ${packageRoot} has no name.`);
	}

	if (!options.includeSelf) {
		const dependencySpecs = [
			...Object.values(manifest.dependencies ?? {}),
			...Object.values(manifest.devDependencies ?? {}),
			...Object.values(manifest.optionalDependencies ?? {}),
			...Object.values(manifest.peerDependencies ?? {}),
		];
		if (!dependencySpecs.some((spec) => spec.startsWith("workspace:"))) {
			return;
		}
	}

	const filter = options.includeSelf
		? `${manifest.name}...`
		: `${manifest.name}^...`;
	let build = prerequisiteBuilds.get(filter);
	if (build === undefined) {
		build = new Promise<void>((resolve, reject) => {
			const child = spawn(
				process.platform === "win32" ? "pnpm.cmd" : "pnpm",
				["exec", "turbo", "run", "build:dep", `--filter=${filter}`],
				{
					cwd: path.resolve(options.workspaceRoot),
					stdio: "inherit",
				},
			);
			child.once("error", reject);
			child.once("exit", (code, signal) => {
				if (code === 0) {
					resolve();
					return;
				}
				reject(
					new Error(
						`Turbo prerequisite build for ${manifest.name} failed (${signal ?? code ?? "unknown"}).`,
					),
				);
			});
		});
		prerequisiteBuilds.set(filter, build);
	}

	await build;
}
