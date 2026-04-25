import { appendFileSync } from "node:fs";

import { loadSecuritydeptMetadata } from "./metadata.ts";
import { parseReleasePolicy } from "./release-policy.ts";

export type DockerPublishOptions = {
	ref?: string;
	sha?: string;
	image?: string;
	revision?: string;
	sourceUrl?: string;
	format: "human" | "json" | "github-output";
	githubOutputPath?: string;
};

export function runDockerPublish(options: DockerPublishOptions): void {
	const metadata = loadSecuritydeptMetadata();
	const resolvedRef = normalizeGitRef(
		options.ref ?? metadata.docker.defaultRef,
	);
	const plan = buildDockerPublishPlan({
		ref: resolvedRef,
		sha: options.sha,
		image: options.image,
		revision: options.revision ?? options.sha,
		sourceUrl: options.sourceUrl,
		metadataVersion: metadata.project.version,
	});

	if (options.format === "json") {
		console.log(JSON.stringify(plan, null, 2));
		return;
	}

	if (options.format === "github-output") {
		writeGithubOutput(
			plan,
			options.githubOutputPath ?? process.env.GITHUB_OUTPUT,
		);
		return;
	}

	console.log(`Resolved git ref: ${plan.ref}`);
	if (plan.releaseVersion) {
		console.log(`Release version: ${plan.releaseVersion}`);
	}
	console.log("Docker tags:");
	for (const tag of plan.tags) {
		console.log(`- ${tag}`);
	}

	if (plan.labels.length > 0) {
		console.log("Docker labels:");
		for (const label of plan.labels) {
			console.log(`- ${label}`);
		}
	}
}

type DockerPublishPlanOptions = {
	ref: string;
	sha?: string;
	image?: string;
	revision?: string;
	sourceUrl?: string;
	metadataVersion: string;
};

type DockerPublishPlan = {
	ref: string;
	releaseVersion: string | null;
	tags: string[];
	labels: string[];
};

function buildDockerPublishPlan(
	options: DockerPublishPlanOptions,
): DockerPublishPlan {
	const tags = new Set<string>();
	const labels = new Set<string>();
	let releaseVersion: string | null = null;

	if (options.ref.startsWith("refs/tags/")) {
		const tagName = options.ref.slice("refs/tags/".length);
		const releasePolicy = parseReleasePolicy(
			tagName.startsWith("v") ? tagName.slice(1) : tagName,
		);
		releaseVersion = releasePolicy.version.version;
		tags.add(releasePolicy.gitTag);
		tags.add(`v${releasePolicy.version.major}.${releasePolicy.version.minor}`);
		tags.add(`v${releasePolicy.version.major}`);
		for (const channelTag of releasePolicy.dockerChannelTags) {
			tags.add(channelTag);
		}
	}

	if (options.ref.startsWith("refs/heads/")) {
		tags.add(sanitizeDockerTag(options.ref.slice("refs/heads/".length)));
	}

	if (options.sha) {
		tags.add(`sha-${options.sha.slice(0, 12)}`);
	}

	if (options.sourceUrl) {
		labels.add(`org.opencontainers.image.source=${options.sourceUrl}`);
	}
	if (options.revision) {
		labels.add(`org.opencontainers.image.revision=${options.revision}`);
	}
	if (releaseVersion) {
		labels.add(`org.opencontainers.image.version=${releaseVersion}`);
	} else {
		labels.add(
			`org.opencontainers.image.version=${sanitizeDockerTag(options.metadataVersion)}`,
		);
	}

	const resolvedTags = [...tags].sort();
	const imageTags =
		typeof options.image === "string" && options.image.length > 0
			? resolvedTags.map((tag) => `${options.image}:${tag}`)
			: resolvedTags;

	return {
		ref: options.ref,
		releaseVersion,
		tags: imageTags,
		labels: [...labels].sort(),
	};
}

function writeGithubOutput(
	plan: DockerPublishPlan,
	githubOutputPath: string | undefined,
): void {
	if (!githubOutputPath) {
		throw new Error(
			"Docker publish with --format=github-output requires GITHUB_OUTPUT or --github-output-path.",
		);
	}

	appendFileSync(githubOutputPath, `ref=${plan.ref}\n`);
	appendFileSync(
		githubOutputPath,
		`release_version=${plan.releaseVersion ?? ""}\n`,
	);
	appendMultilineOutput(githubOutputPath, "tags", plan.tags);
	appendMultilineOutput(githubOutputPath, "labels", plan.labels);
}

function appendMultilineOutput(
	githubOutputPath: string,
	key: string,
	values: string[],
): void {
	appendFileSync(githubOutputPath, `${key}<<__SECURITYDEPT__\n`);
	appendFileSync(githubOutputPath, `${values.join("\n")}\n`);
	appendFileSync(githubOutputPath, "__SECURITYDEPT__\n");
}

function sanitizeDockerTag(value: string): string {
	const sanitized = value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/^[^a-z0-9_]+/u, "")
		.replace(/-+/gu, "-")
		.slice(0, 128);

	if (sanitized.length === 0) {
		throw new Error(`Unable to derive a valid Docker tag from '${value}'.`);
	}

	return sanitized;
}

function normalizeGitRef(ref: string): string {
	if (ref.startsWith("refs/")) {
		return ref;
	}

	if (ref.startsWith("v")) {
		return `refs/tags/${ref}`;
	}

	return `refs/heads/${ref}`;
}
