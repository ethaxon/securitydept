/// <reference types="node" />

// Release-gate contract test
//
// Reads the authoritative public-surface-inventory.json and validates that:
//   1. Every declared export key exists in the corresponding package.json
//   2. Every piece of required evidence (test/example file) exists on disk
//   3. Every docs anchor heading exists in both EN and ZH docs
//   4. The inventory is complete (no undeclared export keys in package.json)
//   5. Inventory stability aligns with 007 canonical stability table
//
// This test turns "contract drift" from a human-memory problem into a
// fail-fast CI problem.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Inventory schema (mirrors JSON structure)
// ---------------------------------------------------------------------------

interface DocsAnchor {
	file: string;
	heading: string;
}

interface SubpathEntry {
	exportKey: string;
	stability: string;
	owner: string;
	changeDiscipline: string;
	evidence: string[];
	docsAnchor: DocsAnchor | null;
}

interface PackageEntry {
	name: string;
	dir: string;
	stability: string;
	buildTool?: string;
	subpaths: SubpathEntry[];
}

interface Inventory {
	packages: PackageEntry[];
	changeDisciplineValues: Record<string, string>;
	migrationLedger: string;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const tsWorkspaceRoot = path.resolve(import.meta.dirname, "../../../../../");
const packagesRoot = path.join(tsWorkspaceRoot, "packages");
const docsRoot = path.resolve(tsWorkspaceRoot, "../../docs");
const inventoryPath = path.join(
	tsWorkspaceRoot,
	"public-surface-inventory.json",
);

function loadInventory(): Inventory {
	const raw = fs.readFileSync(inventoryPath, "utf8");
	return JSON.parse(raw) as Inventory;
}

/**
 * Check whether a markdown heading exists in a file.
 *
 * Searches for a heading line (starting with `#`) that contains the
 * given heading text as a substring. This handles numbered headings
 * like `#### 4. SSR / ...` gracefully.
 */
function hasHeading(filePath: string, heading: string): boolean {
	if (!fs.existsSync(filePath)) return false;
	const lines = fs.readFileSync(filePath, "utf8").split("\n");
	return lines.some((line) => /^#{1,6}\s/.test(line) && line.includes(heading));
}

/** Count the number of markdown heading lines in a file. */
function countHeadings(filePath: string): number {
	const lines = fs.readFileSync(filePath, "utf8").split("\n");
	return lines.filter((line) => /^#{1,6}\s/.test(line)).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("release-gate: public-surface inventory validation", () => {
	const inventory = loadInventory();

	it("inventory file exists and is valid JSON", () => {
		expect(fs.existsSync(inventoryPath)).toBe(true);
		expect(inventory.packages.length).toBeGreaterThan(0);
	});

	it("every declared export key exists in the corresponding package.json", () => {
		const mismatches: string[] = [];

		for (const pkg of inventory.packages) {
			let packageJsonPath: string;
			if (pkg.buildTool === "ng-packagr") {
				// ng-packagr packages emit exports in dist/package.json, not the source package.json.
				// Validate against the built dist artifact instead of skipping.
				packageJsonPath = path.join(
					packagesRoot,
					pkg.dir,
					"dist",
					"package.json",
				);
				if (!fs.existsSync(packageJsonPath)) {
					mismatches.push(
						`${pkg.name}: dist/package.json not found — run build:angular before the release gate`,
					);
					continue;
				}
			} else {
				packageJsonPath = path.join(packagesRoot, pkg.dir, "package.json");
			}

			const packageJson = JSON.parse(
				fs.readFileSync(packageJsonPath, "utf8"),
			) as { exports?: Record<string, unknown> };
			// Filter out "./package.json" — ng-packagr injects it automatically and it
			// is not a public surface that needs to appear in the inventory.
			const actualExportKeys = Object.keys(packageJson.exports ?? {}).filter(
				(k) => k !== "./package.json",
			);

			for (const subpath of pkg.subpaths) {
				if (!actualExportKeys.includes(subpath.exportKey)) {
					const source =
						pkg.buildTool === "ng-packagr"
							? "dist/package.json"
							: "package.json";
					mismatches.push(
						`${pkg.name}: inventory declares "${subpath.exportKey}" but ${source} does not export it`,
					);
				}
			}
		}

		expect(mismatches).toEqual([]);
	});

	it("every package.json export key is declared in the inventory (no undeclared exports)", () => {
		const undeclared: string[] = [];

		for (const pkg of inventory.packages) {
			let packageJsonPath: string;
			if (pkg.buildTool === "ng-packagr") {
				// ng-packagr packages emit exports in dist/package.json, not the source package.json.
				// Validate against the built dist artifact instead of skipping.
				packageJsonPath = path.join(
					packagesRoot,
					pkg.dir,
					"dist",
					"package.json",
				);
				if (!fs.existsSync(packageJsonPath)) {
					// Already reported in the previous test — silently skip here.
					continue;
				}
			} else {
				packageJsonPath = path.join(packagesRoot, pkg.dir, "package.json");
			}

			const packageJson = JSON.parse(
				fs.readFileSync(packageJsonPath, "utf8"),
			) as { exports?: Record<string, unknown> };
			// Filter out "./package.json" — ng-packagr injects it automatically and it
			// is not a public surface that needs to appear in the inventory.
			const actualExportKeys = Object.keys(packageJson.exports ?? {}).filter(
				(k) => k !== "./package.json",
			);
			const inventoryKeys = pkg.subpaths.map((s) => s.exportKey);

			for (const key of actualExportKeys) {
				if (!inventoryKeys.includes(key)) {
					const source =
						pkg.buildTool === "ng-packagr"
							? "dist/package.json"
							: "package.json";
					undeclared.push(
						`${pkg.name}: ${source} exports "${key}" but inventory does not declare it`,
					);
				}
			}
		}

		expect(undeclared).toEqual([]);
	});

	it("every required evidence file exists on disk", () => {
		const missing: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				for (const evidencePath of subpath.evidence) {
					const absPath = path.join(tsWorkspaceRoot, evidencePath);
					if (!fs.existsSync(absPath)) {
						missing.push(
							`${pkg.name} ${subpath.exportKey}: evidence "${evidencePath}" not found`,
						);
					}
				}
			}
		}

		expect(missing).toEqual([]);
	});

	it("every docs anchor heading exists in EN docs", () => {
		const missing: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				if (!subpath.docsAnchor) continue;

				const absPath = path.join(docsRoot, "en", subpath.docsAnchor.file);
				if (!fs.existsSync(absPath)) {
					missing.push(
						`${pkg.name} ${subpath.exportKey}: docs file "${subpath.docsAnchor.file}" not found in docs/en/`,
					);
					continue;
				}

				if (!hasHeading(absPath, subpath.docsAnchor.heading)) {
					missing.push(
						`${pkg.name} ${subpath.exportKey}: heading "${subpath.docsAnchor.heading}" not found in docs/en/${subpath.docsAnchor.file}`,
					);
				}
			}
		}

		expect(missing).toEqual([]);
	});

	it("every docs anchor file has a ZH counterpart", () => {
		const missing: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				if (!subpath.docsAnchor) continue;

				const zhPath = path.join(docsRoot, "zh", subpath.docsAnchor.file);
				if (!fs.existsSync(zhPath)) {
					missing.push(
						`${pkg.name} ${subpath.exportKey}: ZH docs file "${subpath.docsAnchor.file}" not found in docs/zh/`,
					);
				}
			}
		}

		expect(missing).toEqual([]);
	});

	it("ZH docs have structural parity with EN for each anchor file", () => {
		const issues: string[] = [];
		const checkedFiles = new Set<string>();

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				if (!subpath.docsAnchor) continue;
				if (checkedFiles.has(subpath.docsAnchor.file)) continue;
				checkedFiles.add(subpath.docsAnchor.file);

				const enPath = path.join(docsRoot, "en", subpath.docsAnchor.file);
				const zhPath = path.join(docsRoot, "zh", subpath.docsAnchor.file);
				if (!fs.existsSync(enPath) || !fs.existsSync(zhPath)) continue;

				const enHeadings = countHeadings(enPath);
				const zhHeadings = countHeadings(zhPath);

				// ZH docs should have roughly similar section structure.
				// Allow a small tolerance, but not wildly different.
				if (zhHeadings < enHeadings * 0.7) {
					issues.push(
						`${subpath.docsAnchor.file}: ZH has ${zhHeadings} headings vs EN ${enHeadings} — structural drift detected`,
					);
				}
			}
		}

		expect(issues).toEqual([]);
	});

	it("stability values are valid", () => {
		const validLevels = new Set(["stable", "provisional", "experimental"]);
		const invalid: string[] = [];

		for (const pkg of inventory.packages) {
			if (!validLevels.has(pkg.stability)) {
				invalid.push(
					`${pkg.name}: invalid package stability "${pkg.stability}"`,
				);
			}
			for (const subpath of pkg.subpaths) {
				if (!validLevels.has(subpath.stability)) {
					invalid.push(
						`${pkg.name} ${subpath.exportKey}: invalid stability "${subpath.stability}"`,
					);
				}
			}
		}

		expect(invalid).toEqual([]);
	});

	it("inventory stability aligns with 007 canonical stability table", () => {
		const docsPath = path.join(docsRoot, "en", "007-CLIENT_SDK_GUIDE.md");
		const content = fs.readFileSync(docsPath, "utf8");
		const mismatches: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				// Find the stability table row for this subpath.
				// Table format: | `package/subpath` | `stability` | ...
				const subpathIdentifier =
					subpath.exportKey === "."
						? pkg.name
						: `${pkg.name}/${subpath.exportKey.slice(2)}`;
				const escapedId = subpathIdentifier.replace(
					/[.*+?^${}()|[\]\\]/g,
					"\\$&",
				);
				const pattern = new RegExp(
					`\\|\\s*\`${escapedId}\`\\s*\\|\\s*\`(\\w+)\``,
				);
				const match = content.match(pattern);

				if (!match) continue; // Not in the stability table — skip.

				const docsStability = match[1];
				if (docsStability !== subpath.stability) {
					mismatches.push(
						`${subpathIdentifier}: inventory says "${subpath.stability}" but 007 stability table says "${docsStability}"`,
					);
				}
			}
		}

		expect(mismatches).toEqual([]);
	});

	it("non-experimental subpaths have at least one evidence file", () => {
		const lacking: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				if (subpath.stability === "experimental") continue;
				if (subpath.evidence.length === 0) {
					lacking.push(
						`${pkg.name} ${subpath.exportKey}: non-experimental subpath has no evidence`,
					);
				}
			}
		}

		expect(lacking).toEqual([]);
	});

	it("non-experimental subpaths have a docs anchor", () => {
		const lacking: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				if (subpath.stability === "experimental") continue;
				if (!subpath.docsAnchor) {
					lacking.push(
						`${pkg.name} ${subpath.exportKey}: non-experimental subpath has no docs anchor`,
					);
				}
			}
		}

		expect(lacking).toEqual([]);
	});

	it("changeDiscipline values are valid inventory-defined disciplines", () => {
		const validDisciplines = new Set(
			Object.keys(inventory.changeDisciplineValues),
		);
		const invalid: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				if (!validDisciplines.has(subpath.changeDiscipline)) {
					invalid.push(
						`${pkg.name} ${subpath.exportKey}: invalid changeDiscipline "${subpath.changeDiscipline}"`,
					);
				}
			}
		}

		expect(invalid).toEqual([]);
	});

	it("changeDiscipline aligns with stability level", () => {
		const expectedDiscipline: Record<string, string> = {
			stable: "stable-deprecation-first",
			provisional: "provisional-migration-required",
			experimental: "experimental-fast-break",
		};
		const mismatches: string[] = [];

		for (const pkg of inventory.packages) {
			for (const subpath of pkg.subpaths) {
				const expected = expectedDiscipline[subpath.stability];
				if (expected && subpath.changeDiscipline !== expected) {
					mismatches.push(
						`${pkg.name} ${subpath.exportKey}: stability "${subpath.stability}" expects discipline "${expected}" but got "${subpath.changeDiscipline}"`,
					);
				}
			}
		}

		expect(mismatches).toEqual([]);
	});

	it("migration ledger exists in both EN and ZH docs", () => {
		const missing: string[] = [];
		const ledgerFile = inventory.migrationLedger;

		const enPath = path.join(docsRoot, "en", ledgerFile);
		if (!fs.existsSync(enPath)) {
			missing.push(`migration ledger "${ledgerFile}" not found in docs/en/`);
		}

		const zhPath = path.join(docsRoot, "zh", ledgerFile);
		if (!fs.existsSync(zhPath)) {
			missing.push(`migration ledger "${ledgerFile}" not found in docs/zh/`);
		}

		expect(missing).toEqual([]);
	});
});
