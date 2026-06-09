import path from "node:path";
import { type TestProject } from "vitest/node";
import { runTurboPrerequisites } from "../../scripts/tooling/turbo-prerequisites.ts";

export async function setup(project: TestProject): Promise<void> {
	await runTurboPrerequisites({
		workspaceRoot: path.resolve(import.meta.dirname, "../.."),
		packageRoot: project.config.root,
		includeSelf: true,
	});
}
