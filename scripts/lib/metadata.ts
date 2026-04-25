import { readFileSync, writeFileSync } from "node:fs";

import toml from "toml";

import { resolveFromRoot } from "./paths.ts";
import { parseReleasePolicy } from "./release-policy.ts";

export type NodePackageMetadata = {
	name: string;
	manifest: string;
	private: boolean;
	publish: boolean;
};

export type RustPackageMetadata = {
	name: string;
	manifest: string;
	publish: boolean;
};

export type SecuritydeptMetadata = {
	project: {
		version: string;
		displayName: string;
		description: string;
		author: string;
		license: string;
		repositoryUrl: string;
		repositoryGitUrl: string;
		issuesUrl: string;
		homepageUrl: string;
	};
	npm: {
		defaultDistTag: string;
		packDestination: string;
		descriptionBase: string;
		keywords: string[];
	};
	rust: {
		descriptionBase: string;
		keywords: string[];
		documentationUrlBase: string;
	};
	docker: {
		defaultRef: string;
	};
	crates: {
		packageReport: string;
		publishReport: string;
	};
	nodePackages: NodePackageMetadata[];
	rustPackages: RustPackageMetadata[];
};

type RawMetadata = {
	project?: {
		version?: string;
		display_name?: string;
		description?: string;
		author?: string;
		license?: string;
		repository_url?: string;
		repository_git_url?: string;
		issues_url?: string;
		homepage_url?: string;
	};
	npm?: {
		pack_destination?: string;
		description_base?: string;
		keywords?: string[];
	};
	rust?: {
		description_base?: string;
		keywords?: string[];
		documentation_url_base?: string;
	};
	crates?: {
		package_report?: string;
		publish_report?: string;
	};
	node_package?: NodePackageMetadata[];
	rust_package?: RustPackageMetadata[];
};

export const SECURITYDEPT_METADATA_PATH = resolveFromRoot(
	"securitydept-metadata.toml",
);

export function parseReleaseVersion(versionText: string) {
	return parseReleasePolicy(versionText).version;
}

export function computeDefaultNpmDistTag(versionText: string): string {
	return parseReleasePolicy(versionText).npmDistTag;
}

export function computeDefaultDockerRef(versionText: string): string {
	return parseReleasePolicy(versionText).gitTag;
}

export function loadSecuritydeptMetadata(): SecuritydeptMetadata {
	const source = readFileSync(SECURITYDEPT_METADATA_PATH, "utf8");
	const parsed = toml.parse(source) as RawMetadata;
	const version = parsed.project?.version;

	if (!version) {
		throw new Error("securitydept-metadata.toml is missing [project].version");
	}
	if (!parsed.project?.display_name) {
		throw new Error(
			"securitydept-metadata.toml is missing [project].display_name",
		);
	}
	if (!parsed.project.description) {
		throw new Error(
			"securitydept-metadata.toml is missing [project].description",
		);
	}
	if (!parsed.project.author) {
		throw new Error("securitydept-metadata.toml is missing [project].author");
	}
	if (!parsed.project.license) {
		throw new Error("securitydept-metadata.toml is missing [project].license");
	}
	if (!parsed.project.repository_url) {
		throw new Error(
			"securitydept-metadata.toml is missing [project].repository_url",
		);
	}
	if (!parsed.project.repository_git_url) {
		throw new Error(
			"securitydept-metadata.toml is missing [project].repository_git_url",
		);
	}
	if (!parsed.project.issues_url) {
		throw new Error(
			"securitydept-metadata.toml is missing [project].issues_url",
		);
	}
	if (!parsed.project.homepage_url) {
		throw new Error(
			"securitydept-metadata.toml is missing [project].homepage_url",
		);
	}
	if (!parsed.npm?.description_base) {
		throw new Error(
			"securitydept-metadata.toml is missing [npm].description_base",
		);
	}
	if (!parsed.npm.keywords || parsed.npm.keywords.length === 0) {
		throw new Error("securitydept-metadata.toml is missing [npm].keywords");
	}
	if (!parsed.rust?.description_base) {
		throw new Error(
			"securitydept-metadata.toml is missing [rust].description_base",
		);
	}
	if (!parsed.rust.keywords || parsed.rust.keywords.length === 0) {
		throw new Error("securitydept-metadata.toml is missing [rust].keywords");
	}
	if (!parsed.rust.documentation_url_base) {
		throw new Error(
			"securitydept-metadata.toml is missing [rust].documentation_url_base",
		);
	}

	const releasePolicy = parseReleasePolicy(version);

	return {
		project: {
			version: releasePolicy.version.version,
			displayName: parsed.project.display_name,
			description: parsed.project.description,
			author: parsed.project.author,
			license: parsed.project.license,
			repositoryUrl: parsed.project.repository_url,
			repositoryGitUrl: parsed.project.repository_git_url,
			issuesUrl: parsed.project.issues_url,
			homepageUrl: parsed.project.homepage_url,
		},
		npm: {
			defaultDistTag: releasePolicy.npmDistTag,
			packDestination: parsed.npm?.pack_destination ?? "temp/release/npm",
			descriptionBase: parsed.npm.description_base,
			keywords: parsed.npm.keywords,
		},
		rust: {
			descriptionBase: parsed.rust.description_base,
			keywords: parsed.rust.keywords,
			documentationUrlBase: parsed.rust.documentation_url_base,
		},
		docker: {
			defaultRef: releasePolicy.gitTag,
		},
		crates: {
			packageReport:
				parsed.crates?.package_report ??
				"temp/release/crates/package-report.json",
			publishReport:
				parsed.crates?.publish_report ??
				"temp/release/crates/publish-report.json",
		},
		nodePackages: parsed.node_package ?? [],
		rustPackages: parsed.rust_package ?? [],
	};
}

export function writeSecuritydeptMetadataVersion(
	nextVersionText: string,
): SecuritydeptMetadata {
	const parsedVersion = parseReleaseVersion(nextVersionText);
	let source = readFileSync(SECURITYDEPT_METADATA_PATH, "utf8");

	source = replaceSectionStringValue(
		source,
		"project",
		"version",
		parsedVersion.version,
	);

	writeFileSync(SECURITYDEPT_METADATA_PATH, source);

	return loadSecuritydeptMetadata();
}

function replaceSectionStringValue(
	source: string,
	sectionName: string,
	key: string,
	nextValue: string,
): string {
	const eol = source.includes("\r\n") ? "\r\n" : "\n";
	const lines = source.split(/\r?\n/u);
	let inSection = false;
	let replaced = false;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		const trimmed = line.trim();

		if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
			inSection = trimmed === `[${sectionName}]`;
			continue;
		}

		if (!inSection || !trimmed.startsWith(`${key} = `)) {
			continue;
		}

		const indentation = line.slice(0, line.length - line.trimStart().length);
		lines[index] = `${indentation}${key} = ${JSON.stringify(nextValue)}`;
		replaced = true;
		break;
	}

	if (!replaced) {
		throw new Error(
			`securitydept-metadata.toml is missing [${sectionName}].${key}`,
		);
	}

	return lines.join(eol);
}
