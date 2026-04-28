import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

import { loadSecuritydeptMetadata } from "./metadata.ts";
import { runCommand } from "./process.ts";
import { parseReleasePolicy } from "./release-policy.ts";
import { ensureVersionConsistency } from "./version.ts";

export const ReleaseRefValidationKind = {
	Release: "release",
	Npm: "npm",
	Crates: "crates",
} as const;

export type ReleaseRefValidationKind =
	(typeof ReleaseRefValidationKind)[keyof typeof ReleaseRefValidationKind];

export type ValidateReleaseRefOptions = {
	kind: ReleaseRefValidationKind;
	mode?: string;
	publishMode?: string;
	ref?: string;
	refName?: string;
	sha?: string;
	releaseBranch?: string;
	format: "human" | "github-output";
	githubOutputPath?: string;
};

export type EnsureReleaseTagOptions = {
	ref?: string;
	refName?: string;
	sha?: string;
	releaseBranch?: string;
	push: boolean;
};

const ExpectedTagPolicy = "create-after-publish";

type ExpectedTagStatus =
	| "not-checked"
	| "missing"
	| "exists-same-sha"
	| "exists-different-sha";

type ExpectedTagState = {
	status: ExpectedTagStatus;
	target: string;
};

type ValidateReleaseRefResult = {
	canPublish: boolean;
	tagName: string;
	tagTarget: string;
	expectedTag: string;
	expectedTagStatus: ExpectedTagStatus;
	expectedTagTarget: string;
	expectedTagPolicy: typeof ExpectedTagPolicy;
	ref: string;
	releaseBranch: string;
};

export function runValidateReleaseRef(
	options: ValidateReleaseRefOptions,
): void {
	const result = validateReleaseRef(options);

	if (options.format === "github-output") {
		writeGithubOutput(
			result,
			options.githubOutputPath ?? process.env.GITHUB_OUTPUT,
		);
		return;
	}

	if (!result.canPublish) {
		console.log(
			`Mode '${options.mode ?? options.publishMode ?? "publish"}' does not need a ${options.kind} publish ref guard.`,
		);
		return;
	}

	console.log(`Validated ${options.kind} publish ref: ${result.ref}`);
	console.log(`Expected tag: ${result.expectedTag}`);
	console.log(`Expected tag policy: ${result.expectedTagPolicy}`);
	console.log(`Expected tag status: ${result.expectedTagStatus}`);
	if (result.expectedTagTarget) {
		console.log(`Expected tag target: ${result.expectedTagTarget}`);
	}
	console.log(`Tag target: ${result.tagTarget}`);
	console.log(`Release branch: ${result.releaseBranch}`);
	console.log("can_publish=true");
}

export function runEnsureReleaseTag(options: EnsureReleaseTagOptions): void {
	ensureVersionConsistency();

	const metadata = loadSecuritydeptMetadata();
	const expectedTag = parseReleasePolicy(metadata.project.version).gitTag;
	const ref = options.ref ?? process.env.GITHUB_REF ?? "";
	const refName =
		options.refName ?? process.env.GITHUB_REF_NAME ?? deriveRefName(ref);
	const sourceSha = options.sha ?? process.env.GITHUB_SHA ?? "";
	const releaseBranch = options.releaseBranch ?? "release";

	if (!sourceSha) {
		throw new Error("Ensuring the release tag requires a source SHA.");
	}

	if (ref.startsWith("refs/tags/")) {
		const tagName = refName.length > 0 ? refName : deriveRefName(ref);
		if (tagName !== expectedTag) {
			throw new Error(
				`Release tag ${tagName} does not match workspace version ${expectedTag}.`,
			);
		}
		console.log(`Release tag ${expectedTag} already selected as source.`);
		return;
	}

	if (ref !== `refs/heads/${releaseBranch}`) {
		throw new Error(
			`Release tag creation is only enabled for refs/heads/${releaseBranch} or refs/tags/${expectedTag}.`,
		);
	}

	const tagState = inspectExpectedTag(expectedTag, sourceSha, true);
	if (tagState.status === "exists-different-sha") {
		throw new Error(
			expectedTagMismatchError(expectedTag, tagState.target, sourceSha),
		);
	}

	if (tagState.status === "exists-same-sha") {
		console.log(
			`Release tag ${expectedTag} already points to ${tagState.target}.`,
		);
		return;
	}

	runCommand("git", ["tag", expectedTag, sourceSha]);
	console.log(`Created release tag ${expectedTag} at ${sourceSha}.`);
	if (options.push) {
		runCommand("git", ["push", "origin", `refs/tags/${expectedTag}`]);
		console.log(`Pushed release tag ${expectedTag}.`);
	}
}

function validateReleaseRef(
	options: ValidateReleaseRefOptions,
): ValidateReleaseRefResult {
	ensureVersionConsistency();

	const publishMode = options.publishMode ?? "publish";
	const mode = options.mode ?? publishMode;
	const metadata = loadSecuritydeptMetadata();
	const expectedTag = parseReleasePolicy(metadata.project.version).gitTag;
	const ref = options.ref ?? process.env.GITHUB_REF ?? "";
	const refName =
		options.refName ?? process.env.GITHUB_REF_NAME ?? deriveRefName(ref);
	const sourceSha = options.sha ?? process.env.GITHUB_SHA ?? "";
	const releaseBranch = options.releaseBranch ?? "release";

	if (mode !== publishMode) {
		return {
			canPublish: false,
			tagName: "",
			tagTarget: "",
			expectedTag,
			expectedTagStatus: "not-checked",
			expectedTagTarget: "",
			expectedTagPolicy: ExpectedTagPolicy,
			ref,
			releaseBranch,
		};
	}

	if (ref === `refs/heads/${releaseBranch}`) {
		return validateReleaseBranchRef({
			kind: options.kind,
			ref,
			releaseBranch,
			expectedTag,
			sourceSha,
		});
	}

	if (!ref.startsWith("refs/tags/v")) {
		throw new Error(nonTagPublishRefError(options.kind));
	}

	const tagName = refName.length > 0 ? refName : deriveRefName(ref);
	if (tagName !== expectedTag) {
		throw new Error(tagMismatchError(options.kind, tagName, expectedTag));
	}

	if (isLocalActionsRun()) {
		const tagTarget = resolveLocalTagTarget(tagName, sourceSha);
		return {
			canPublish: true,
			tagName,
			tagTarget,
			expectedTag,
			expectedTagStatus: "exists-same-sha",
			expectedTagTarget: tagTarget,
			expectedTagPolicy: ExpectedTagPolicy,
			ref,
			releaseBranch,
		};
	}

	const tagTarget = readGitStdout(["rev-list", "-n", "1", tagName]);

	runCommand("git", [
		"fetch",
		"--no-tags",
		"origin",
		`${releaseBranch}:refs/remotes/origin/${releaseBranch}`,
	]);

	const mergeBaseStatus = spawnSync(
		"git",
		[
			"merge-base",
			"--is-ancestor",
			tagTarget,
			`refs/remotes/origin/${releaseBranch}`,
		],
		{
			stdio: "inherit",
		},
	);

	if (mergeBaseStatus.status !== 0) {
		throw new Error(
			tagTargetReachabilityError(options.kind, tagTarget, releaseBranch),
		);
	}

	return {
		canPublish: true,
		tagName,
		tagTarget,
		expectedTag,
		expectedTagStatus: "exists-same-sha",
		expectedTagTarget: tagTarget,
		expectedTagPolicy: ExpectedTagPolicy,
		ref,
		releaseBranch,
	};
}

function validateReleaseBranchRef(options: {
	kind: ReleaseRefValidationKind;
	ref: string;
	releaseBranch: string;
	expectedTag: string;
	sourceSha: string;
}): ValidateReleaseRefResult {
	if (!options.sourceSha) {
		throw new Error(
			`Release branch publish requires a source SHA for refs/heads/${options.releaseBranch}.`,
		);
	}

	if (isLocalActionsRun()) {
		validateLocalCommit(options.sourceSha);
		const tagState = inspectExpectedTag(
			options.expectedTag,
			options.sourceSha,
			false,
		);
		if (tagState.status === "exists-different-sha") {
			throw new Error(
				expectedTagMismatchError(
					options.expectedTag,
					tagState.target,
					options.sourceSha,
				),
			);
		}
		return {
			canPublish: true,
			tagName: options.expectedTag,
			tagTarget: options.sourceSha,
			expectedTag: options.expectedTag,
			expectedTagStatus: tagState.status,
			expectedTagTarget: tagState.target,
			expectedTagPolicy: ExpectedTagPolicy,
			ref: options.ref,
			releaseBranch: options.releaseBranch,
		};
	}

	runCommand("git", [
		"fetch",
		"--no-tags",
		"origin",
		`${options.releaseBranch}:refs/remotes/origin/${options.releaseBranch}`,
	]);

	const mergeBaseStatus = spawnSync(
		"git",
		[
			"merge-base",
			"--is-ancestor",
			options.sourceSha,
			`refs/remotes/origin/${options.releaseBranch}`,
		],
		{
			stdio: "inherit",
		},
	);

	if (mergeBaseStatus.status !== 0) {
		throw new Error(
			tagTargetReachabilityError(
				options.kind,
				options.sourceSha,
				options.releaseBranch,
			),
		);
	}

	const tagState = inspectExpectedTag(
		options.expectedTag,
		options.sourceSha,
		true,
	);
	if (tagState.status === "exists-different-sha") {
		throw new Error(
			expectedTagMismatchError(
				options.expectedTag,
				tagState.target,
				options.sourceSha,
			),
		);
	}

	return {
		canPublish: true,
		tagName: options.expectedTag,
		tagTarget: options.sourceSha,
		expectedTag: options.expectedTag,
		expectedTagStatus: tagState.status,
		expectedTagTarget: tagState.target,
		expectedTagPolicy: ExpectedTagPolicy,
		ref: options.ref,
		releaseBranch: options.releaseBranch,
	};
}

function isLocalActionsRun(): boolean {
	return (
		process.env.ACT === "true" ||
		process.env.SECURITYDEPT_LOCAL_ACTIONS === "true"
	);
}

function resolveLocalTagTarget(tagName: string, sourceSha: string): string {
	if (sourceSha) {
		validateLocalCommit(sourceSha);
		return sourceSha;
	}

	return readGitStdout(["rev-list", "-n", "1", tagName]);
}

function validateLocalCommit(sha: string): void {
	const status = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
		stdio: "ignore",
	});

	if (status.status !== 0) {
		throw new Error(`Local release validation could not find commit ${sha}.`);
	}
}

function writeGithubOutput(
	result: ValidateReleaseRefResult,
	githubOutputPath: string | undefined,
): void {
	if (!githubOutputPath) {
		throw new Error(
			"Validate release ref with --format=github-output requires GITHUB_OUTPUT or --github-output-path.",
		);
	}

	appendFileSync(
		githubOutputPath,
		`can_publish=${result.canPublish ? "true" : "false"}\n`,
	);
	appendFileSync(githubOutputPath, `tag_name=${result.tagName}\n`);
	appendFileSync(githubOutputPath, `tag_target=${result.tagTarget}\n`);
	appendFileSync(githubOutputPath, `expected_tag=${result.expectedTag}\n`);
	appendFileSync(
		githubOutputPath,
		`expected_tag_status=${result.expectedTagStatus}\n`,
	);
	appendFileSync(
		githubOutputPath,
		`expected_tag_target=${result.expectedTagTarget}\n`,
	);
	appendFileSync(
		githubOutputPath,
		`expected_tag_policy=${result.expectedTagPolicy}\n`,
	);
}

function inspectExpectedTag(
	tagName: string,
	sourceSha: string,
	fetchRemote: boolean,
): ExpectedTagState {
	if (fetchRemote && !isLocalActionsRun()) {
		fetchRemoteTagIfExists(tagName);
	}

	const tagTarget = tryReadTagTarget(tagName);
	if (!tagTarget) {
		return { status: "missing", target: "" };
	}

	const normalizedSourceSha = normalizeCommit(sourceSha);
	return {
		status:
			tagTarget === normalizedSourceSha
				? "exists-same-sha"
				: "exists-different-sha",
		target: tagTarget,
	};
}

function fetchRemoteTagIfExists(tagName: string): void {
	spawnSync(
		"git",
		[
			"fetch",
			"--no-tags",
			"origin",
			`+refs/tags/${tagName}:refs/tags/${tagName}`,
		],
		{ stdio: "ignore" },
	);
}

function tryReadTagTarget(tagName: string): string | undefined {
	const result = spawnSync("git", ["rev-list", "-n", "1", tagName], {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "ignore"],
	});
	if (result.status !== 0) {
		return undefined;
	}
	return result.stdout.trim() || undefined;
}

function normalizeCommit(sha: string): string {
	return readGitStdout(["rev-parse", `${sha}^{commit}`]);
}

function readGitStdout(args: string[]): string {
	const result = spawnSync("git", args, {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "inherit"],
	});

	if (result.status !== 0) {
		throw new Error(
			`Command failed: git ${args.join(" ")} (${result.status ?? "unknown"})`,
		);
	}

	return result.stdout.trim();
}

function deriveRefName(ref: string): string {
	if (ref.startsWith("refs/tags/")) {
		return ref.slice("refs/tags/".length);
	}

	if (ref.startsWith("refs/heads/")) {
		return ref.slice("refs/heads/".length);
	}

	return ref;
}

function nonTagPublishRefError(kind: ReleaseRefValidationKind): string {
	switch (kind) {
		case ReleaseRefValidationKind.Npm:
			return "npm publish mode must run from a refs/tags/v* ref.";
		case ReleaseRefValidationKind.Crates:
			return "crates publish mode must run from a refs/tags/v* ref.";
		default:
			return "Release publish is only enabled for refs/tags/v* or refs/heads/release.";
	}
}

function tagMismatchError(
	kind: ReleaseRefValidationKind,
	tagName: string,
	expectedTag: string,
): string {
	switch (kind) {
		case ReleaseRefValidationKind.Npm:
			return `npm publish tag ${tagName} does not match workspace version ${expectedTag}.`;
		case ReleaseRefValidationKind.Crates:
			return `crates publish tag ${tagName} does not match workspace version ${expectedTag}.`;
		default:
			return `Release tag ${tagName} does not match workspace version ${expectedTag}.`;
	}
}

function tagTargetReachabilityError(
	kind: ReleaseRefValidationKind,
	tagTarget: string,
	releaseBranch: string,
): string {
	switch (kind) {
		case ReleaseRefValidationKind.Npm:
			return `npm publish tag target ${tagTarget} is not reachable from origin/${releaseBranch}.`;
		case ReleaseRefValidationKind.Crates:
			return `crates publish tag target ${tagTarget} is not reachable from origin/${releaseBranch}.`;
		default:
			return `Release tag target ${tagTarget} is not reachable from origin/${releaseBranch}.`;
	}
}

function expectedTagMismatchError(
	expectedTag: string,
	actualTarget: string,
	expectedTarget: string,
): string {
	return `Expected release tag ${expectedTag} already points to ${actualTarget}, not ${expectedTarget}.`;
}
