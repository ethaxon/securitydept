import {
	existsSync,
	lstatSync,
	mkdirSync,
	readlinkSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

type LinkEntry = {
	link: string;
	target: string;
	type: "file" | "dir";
};

const docsiteRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(docsiteRoot, "..");

const entries: LinkEntry[] = [
	{ link: "index.md", target: "README.md", type: "file" },
	{ link: "agents.md", target: "AGENTS.md", type: "file" },
	{ link: "license.md", target: "LICENSE.md", type: "file" },
	{ link: "docs", target: "docs/en", type: "dir" },
	{ link: "zh/index.md", target: "README_zh.md", type: "file" },
	{ link: "zh/agents.md", target: "AGENTS.md", type: "file" },
	{ link: "zh/license.md", target: "LICENSE.md", type: "file" },
	{ link: "zh/docs", target: "docs/zh", type: "dir" },
];

function normalizePathForCompare(path: string) {
	return path.replace(/\\/g, "/");
}

function ensureRelativeSymlink(entry: LinkEntry): "skipped" | "linked" {
	const linkPath = resolve(docsiteRoot, entry.link);
	const targetPath = resolve(repoRoot, entry.target);
	const relativeTarget = relative(dirname(linkPath), targetPath);

	if (!existsSync(targetPath)) {
		throw new Error(`Link source missing: ${targetPath}`);
	}

	mkdirSync(dirname(linkPath), { recursive: true });

	if (existsSync(linkPath)) {
		const stat = lstatSync(linkPath);
		if (stat.isSymbolicLink()) {
			const currentRawTarget = readlinkSync(linkPath);
			const currentResolvedTarget = resolve(
				dirname(linkPath),
				currentRawTarget,
			);
			if (
				!isAbsolute(currentRawTarget) &&
				normalizePathForCompare(currentRawTarget) ===
					normalizePathForCompare(relativeTarget) &&
				normalizePathForCompare(currentResolvedTarget) ===
					normalizePathForCompare(targetPath)
			) {
				return "skipped";
			}
		}

		rmSync(linkPath, { recursive: true, force: true });
	}

	try {
		symlinkSync(relativeTarget, linkPath, entry.type);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to create relative symlink ${entry.link} -> ${relativeTarget}. ` +
				`This repository requires Git-compatible relative symlinks; your environment does not support them. ` +
				`Original error: ${message}`,
		);
	}

	console.log(`linked ${entry.link} -> ${entry.target}`);
	return "linked";
}

let linkedCount = 0;
let skippedCount = 0;

for (const entry of entries) {
	const result = ensureRelativeSymlink(entry);
	if (result === "linked") {
		linkedCount += 1;
	}
	if (result === "skipped") {
		skippedCount += 1;
	}
}

console.log(
	`Docsite symlink sync completed. Linked: ${linkedCount}, Skipped: ${skippedCount}.`,
);
