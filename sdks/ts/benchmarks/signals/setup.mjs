import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "tsdown";

export default async function setup(project) {
	const root = path.resolve(import.meta.dirname, "../../../..");
	const sourcePath = "sdks/ts/packages/client/src/rx/signal.ts";
	const entry = path.join(root, sourcePath);
	const output = path.join(root, "temp/signal-benchmark");
	mkdirSync(output, { recursive: true });
	const baseline = execFileSync(
		"git",
		[
			"rev-parse",
			"--verify",
			`${process.env.SIGNAL_BASELINE ?? "HEAD"}^{commit}`,
		],
		{ cwd: root, encoding: "utf8" },
	).trim();
	const sources = {
		baseline: execFileSync("git", ["show", `${baseline}:${sourcePath}`], {
			cwd: root,
			encoding: "utf8",
		}),
		working: readFileSync(entry, "utf8"),
	};
	const modules = {};
	const bundles = {};
	const hash = (value) => createHash("sha256").update(value).digest("hex");
	for (const [name, source] of Object.entries(sources)) {
		const outfile = path.join(output, `${name}.mjs`);
		await build({
			config: false,
			entry: { [name]: entry },
			outDir: output,
			clean: false,
			format: "esm",
			platform: "node",
			target: "es2022",
			dts: false,
			sourcemap: true,
			logLevel: "silent",
			deps: { neverBundle: true },
			plugins: [
				{
					name: "signal-source",
					load(id) {
						if (id === entry) {
							return { code: source };
						}
						return null;
					},
				},
			],
		});
		modules[name] = pathToFileURL(outfile).href;
		bundles[name] = hash(readFileSync(outfile));
	}
	writeFileSync(
		path.join(output, "metadata.json"),
		`${JSON.stringify(
			{
				timestamp: new Date().toISOString(),
				node: process.version,
				v8: process.versions.v8,
				platform: process.platform,
				arch: process.arch,
				cpu: os.cpus()[0]?.model,
				baseline,
				sourceHashes: Object.fromEntries(
					Object.entries(sources).map(([name, source]) => [name, hash(source)]),
				),
				bundleHashes: bundles,
				lockHash: hash(readFileSync(path.join(root, "pnpm-lock.yaml"))),
				dependencies: JSON.parse(
					readFileSync(
						path.join(root, "sdks/ts/benchmarks/package.json"),
						"utf8",
					),
				).devDependencies,
				method:
					"Vitest 4/Tinybench; 256 operations per timing sample; shared current support modules; retained memory and collection measured separately in isolated Node processes.",
			},
			null,
			2,
		)}\n`,
	);
	project.provide("signalModules", modules);
	project.provide("signalOutput", output);
}
