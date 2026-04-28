import { spawnSync } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

import { loadSecuritydeptMetadata } from "./metadata.ts";
import { resolveFromRoot } from "./paths.ts";
import { parseReleasePolicy } from "./release-policy.ts";
import { collectVersionMismatches } from "./version.ts";

export type GithubOutputFormat = "human" | "github-output" | "json";

export type TestsPreflightOptions = {
	workflowFile: string;
	reportPath: string;
	format: GithubOutputFormat;
	githubOutputPath?: string;
	repository?: string;
	githubToken?: string;
	runId?: string;
	eventName?: string;
	eventPath?: string;
	ref?: string;
	sha?: string;
};

export type ReleasePlanOptions = {
	reportPath: string;
	format: GithubOutputFormat;
	githubOutputPath?: string;
	eventName?: string;
	eventPath?: string;
	sourceRef?: string;
	sourceSha?: string;
	publishNpm?: string;
	publishCrates?: string;
	publishDocker?: string;
	localRun?: string;
	releaseBranch: string;
};

type WorkflowSource = {
	sourceEvent: string;
	sourceRef: string;
	sourceRefName: string;
	sourceSha: string;
};

type TestsPreflightReport = WorkflowSource & {
	schemaVersion: 1;
	createdAt: string;
	runTests: boolean;
	releasePrepareCandidate: boolean;
	cacheScope: string;
	reusedRunId: string;
	reusedRunUrl: string;
};

type ReleasePlanReport = WorkflowSource & {
	schemaVersion: 1;
	createdAt: string;
	version: string;
	expectedTag: string;
	expectedTagStatus: "missing" | "exists-same-sha" | "exists-different-sha";
	expectedTagTarget: string;
	expectedTagPolicy: "create-after-publish";
	canPublish: boolean;
	publishNpm: boolean;
	publishCrates: boolean;
	publishDocker: boolean;
	localRun: boolean;
	cacheScope: string;
	releaseBranch: string;
};

type GithubWorkflowRun = {
	id?: number;
	html_url?: string;
	head_sha?: string;
	conclusion?: string | null;
	event?: string;
	head_branch?: string | null;
};

type GithubEventPayload = {
	pull_request?: {
		number?: number;
		head?: {
			sha?: string;
			ref?: string;
		};
	};
	workflow_run?: GithubWorkflowRun;
};

export async function runTestsPreflight(
	options: TestsPreflightOptions,
): Promise<void> {
	const source = resolveCurrentWorkflowSource(options);
	const isAutomatic =
		(options.eventName ?? process.env.GITHUB_EVENT_NAME) !==
		"workflow_dispatch";
	const reusedRun = isAutomatic
		? await findSuccessfulWorkflowRunForSha(options, source.sourceSha)
		: undefined;
	const report: TestsPreflightReport = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		...source,
		runTests: reusedRun === undefined,
		releasePrepareCandidate: isReleaseCandidateRef(source.sourceRef),
		cacheScope: deriveCacheScope(source.sourceRef, source.sourceRefName),
		reusedRunId: reusedRun?.id?.toString() ?? "",
		reusedRunUrl: reusedRun?.html_url ?? "",
	};

	writeJsonReport(options.reportPath, report);
	emitResult(
		options,
		{
			run_tests: String(report.runTests),
			release_prepare_candidate: String(report.releasePrepareCandidate),
			source_event: report.sourceEvent,
			source_ref: report.sourceRef,
			source_ref_name: report.sourceRefName,
			source_sha: report.sourceSha,
			cache_scope: report.cacheScope,
			reused_run_id: report.reusedRunId,
			reused_run_url: report.reusedRunUrl,
			report_path: options.reportPath,
		},
		report,
	);
}

export function runReleasePlan(options: ReleasePlanOptions): void {
	ensureWorkflowVersionConsistency();

	const source = resolveReleaseWorkflowSource(options);
	const metadata = loadSecuritydeptMetadata();
	const releasePolicy = parseReleasePolicy(metadata.project.version);
	const canPublish = isPublishableReleaseSource(
		source.sourceRef,
		options.releaseBranch,
	);
	const isWorkflowRun =
		(options.eventName ?? process.env.GITHUB_EVENT_NAME) === "workflow_run";
	const autoPublish = isWorkflowRun && canPublish;
	const localRun = resolveLocalRun(options.localRun);
	const expectedTagState = inspectLocalExpectedTag(
		releasePolicy.gitTag,
		source.sourceSha,
	);
	const report: ReleasePlanReport = {
		schemaVersion: 1,
		createdAt: new Date().toISOString(),
		...source,
		version: metadata.project.version,
		expectedTag: releasePolicy.gitTag,
		...expectedTagState,
		expectedTagPolicy: "create-after-publish",
		canPublish,
		publishNpm: resolvePublishFlag(options.publishNpm, autoPublish),
		publishCrates: resolvePublishFlag(options.publishCrates, autoPublish),
		publishDocker: resolvePublishFlag(options.publishDocker, autoPublish),
		localRun,
		cacheScope: source.sourceRef.startsWith("refs/tags/")
			? options.releaseBranch
			: deriveCacheScope(source.sourceRef, source.sourceRefName),
		releaseBranch: options.releaseBranch,
	};

	writeJsonReport(options.reportPath, report);
	emitResult(
		options,
		{
			source_event: report.sourceEvent,
			source_ref: report.sourceRef,
			source_ref_name: report.sourceRefName,
			source_sha: report.sourceSha,
			version: report.version,
			expected_tag: report.expectedTag,
			expected_tag_status: report.expectedTagStatus,
			expected_tag_target: report.expectedTagTarget,
			expected_tag_policy: report.expectedTagPolicy,
			can_publish: String(report.canPublish),
			publish_npm: String(report.publishNpm),
			publish_crates: String(report.publishCrates),
			publish_docker: String(report.publishDocker),
			local_run: String(report.localRun),
			cache_scope: report.cacheScope,
			release_branch: report.releaseBranch,
			report_path: options.reportPath,
		},
		report,
	);
}

function ensureWorkflowVersionConsistency(): void {
	const mismatches = collectVersionMismatches();
	if (mismatches.length === 0) {
		return;
	}

	for (const mismatch of mismatches) {
		const prefix =
			mismatch.kind === "cargo-dependency-version"
				? "cargo dependency version mismatch"
				: "manifest version mismatch";
		console.error(
			`${prefix}: ${mismatch.name}: expected ${mismatch.expectedVersion}, found ${mismatch.actualVersion} (${mismatch.manifest})`,
		);
	}

	throw new Error(`Found ${mismatches.length} release version mismatches.`);
}

function resolveCurrentWorkflowSource(
	options: TestsPreflightOptions,
): WorkflowSource {
	const eventName = options.eventName ?? process.env.GITHUB_EVENT_NAME ?? "";
	const payload = readGithubEventPayload(options.eventPath);

	if (eventName === "pull_request" && payload.pull_request) {
		const pullRequest = payload.pull_request;
		const number = pullRequest.number?.toString() ?? "unknown";
		return {
			sourceEvent: eventName,
			sourceRef: `refs/pull/${number}/head`,
			sourceRefName: `pr-${number}`,
			sourceSha:
				pullRequest.head?.sha ?? options.sha ?? process.env.GITHUB_SHA ?? "",
		};
	}

	const ref = options.ref ?? process.env.GITHUB_REF ?? "";
	return {
		sourceEvent: eventName,
		sourceRef: ref,
		sourceRefName: deriveRefName(ref),
		sourceSha: options.sha ?? process.env.GITHUB_SHA ?? "",
	};
}

function resolveReleaseWorkflowSource(
	options: ReleasePlanOptions,
): WorkflowSource {
	const eventName = options.eventName ?? process.env.GITHUB_EVENT_NAME ?? "";
	const payload = readGithubEventPayload(options.eventPath);

	if (eventName === "workflow_run" && payload.workflow_run) {
		const run = payload.workflow_run;
		if (run.conclusion !== "success") {
			return {
				sourceEvent: run.event ?? eventName,
				sourceRef: "",
				sourceRefName: "",
				sourceSha: run.head_sha ?? "",
			};
		}
		const refName = run.head_branch ?? "";
		const sourceRef = deriveSourceRefFromWorkflowRunBranch(refName);
		return {
			sourceEvent: run.event ?? eventName,
			sourceRef,
			sourceRefName: deriveRefName(sourceRef),
			sourceSha: run.head_sha ?? "",
		};
	}

	const ref = nonEmpty(options.sourceRef) ?? process.env.GITHUB_REF ?? "";
	return {
		sourceEvent: eventName,
		sourceRef: ref,
		sourceRefName: deriveRefName(ref),
		sourceSha: nonEmpty(options.sourceSha) ?? process.env.GITHUB_SHA ?? "",
	};
}

function nonEmpty(value: string | undefined): string | undefined {
	return value && value.length > 0 ? value : undefined;
}

async function findSuccessfulWorkflowRunForSha(
	options: TestsPreflightOptions,
	sha: string,
): Promise<GithubWorkflowRun | undefined> {
	const token =
		options.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	const repository = options.repository ?? process.env.GITHUB_REPOSITORY;
	const currentRunId = options.runId ?? process.env.GITHUB_RUN_ID;

	if (!token || !repository || !sha) {
		return undefined;
	}

	const url = new URL(
		`https://api.github.com/repos/${repository}/actions/workflows/${options.workflowFile}/runs`,
	);
	url.searchParams.set("head_sha", sha);
	url.searchParams.set("status", "success");
	url.searchParams.set("per_page", "20");

	const response = await fetch(url, {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"x-github-api-version": "2022-11-28",
		},
	});

	if (!response.ok) {
		throw new Error(
			`Unable to query successful ${options.workflowFile} runs for ${sha}: ${response.status} ${response.statusText}`,
		);
	}

	const body = (await response.json()) as {
		workflow_runs?: GithubWorkflowRun[];
	};
	return body.workflow_runs?.find((run) => {
		if (run.conclusion !== "success") {
			return false;
		}
		if (currentRunId && run.id?.toString() === currentRunId) {
			return false;
		}
		return run.head_sha === sha;
	});
}

function readGithubEventPayload(
	eventPath: string | undefined,
): GithubEventPayload {
	const resolvedPath = eventPath ?? process.env.GITHUB_EVENT_PATH;
	if (!resolvedPath) {
		return {};
	}

	try {
		return JSON.parse(readFileSync(resolvedPath, "utf8")) as GithubEventPayload;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Unable to read GitHub event payload from ${resolvedPath}: ${message}`,
		);
	}
}

function deriveSourceRefFromWorkflowRunBranch(refName: string): string {
	if (refName.length === 0) {
		return "";
	}
	if (/^v\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/u.test(refName)) {
		return `refs/tags/${refName}`;
	}
	return `refs/heads/${refName}`;
}

function deriveRefName(ref: string): string {
	if (ref.startsWith("refs/tags/")) {
		return ref.slice("refs/tags/".length);
	}
	if (ref.startsWith("refs/heads/")) {
		return ref.slice("refs/heads/".length);
	}
	if (ref.startsWith("refs/pull/")) {
		return ref.replace(/^refs\/pull\//u, "pr-").replace(/\/head$/u, "");
	}
	return ref;
}

function inspectLocalExpectedTag(
	tagName: string,
	sourceSha: string,
): Pick<ReleasePlanReport, "expectedTagStatus" | "expectedTagTarget"> {
	const tagTarget = readGitStdoutOrUndefined(["rev-list", "-n", "1", tagName]);
	if (!tagTarget) {
		return { expectedTagStatus: "missing", expectedTagTarget: "" };
	}

	const normalizedSourceSha = sourceSha
		? readGitStdoutOrUndefined(["rev-parse", `${sourceSha}^{commit}`])
		: undefined;
	return {
		expectedTagStatus:
			tagTarget === normalizedSourceSha
				? "exists-same-sha"
				: "exists-different-sha",
		expectedTagTarget: tagTarget,
	};
}

function readGitStdoutOrUndefined(args: string[]): string | undefined {
	const result = spawnSync("git", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
	if (result.status !== 0) {
		return undefined;
	}
	return result.stdout.trim() || undefined;
}

function isReleaseCandidateRef(ref: string): boolean {
	return (
		ref === "refs/heads/release" || /^refs\/tags\/v\d+\.\d+\.\d+/u.test(ref)
	);
}

function deriveCacheScope(ref: string, refName: string): string {
	if (ref.startsWith("refs/tags/")) {
		return "release";
	}
	return (refName.length > 0 ? refName : "unknown").replace(
		/[^A-Za-z0-9_.-]+/gu,
		"-",
	);
}

function isPublishableReleaseSource(
	ref: string,
	releaseBranch: string,
): boolean {
	return (
		ref === `refs/heads/${releaseBranch}` ||
		/^refs\/tags\/v\d+\.\d+\.\d+/u.test(ref)
	);
}

function resolvePublishFlag(
	value: string | undefined,
	defaultValue: boolean,
): boolean {
	if (!value || value === "auto") {
		return defaultValue;
	}
	return value === "true" || value === "1" || value === "yes";
}

function resolveLocalRun(value: string | undefined): boolean {
	if (value && value !== "auto") {
		return value === "true" || value === "1" || value === "yes";
	}

	return (
		process.env.ACT === "true" ||
		process.env.SECURITYDEPT_LOCAL_ACTIONS === "true"
	);
}

function writeJsonReport(relativePath: string, value: unknown): void {
	const reportPath = resolveFromRoot(relativePath);
	mkdirSync(path.dirname(reportPath), { recursive: true });
	writeFileSync(reportPath, `${JSON.stringify(value, null, 2)}\n`);
}

function emitResult(
	options: { format: GithubOutputFormat; githubOutputPath?: string },
	outputs: Record<string, string>,
	report: unknown,
): void {
	if (options.format === "json") {
		console.log(JSON.stringify(report, null, 2));
		return;
	}
	if (options.format === "github-output") {
		writeGithubOutput(
			outputs,
			options.githubOutputPath ?? process.env.GITHUB_OUTPUT,
		);
		return;
	}
	for (const [key, value] of Object.entries(outputs)) {
		console.log(`${key}=${value}`);
	}
}

function writeGithubOutput(
	outputs: Record<string, string>,
	githubOutputPath: string | undefined,
): void {
	if (!githubOutputPath) {
		throw new Error(
			"GITHUB_OUTPUT or --github-output-path is required for github-output format.",
		);
	}
	for (const [key, value] of Object.entries(outputs)) {
		appendFileSync(githubOutputPath, `${key}=${value}\n`);
	}
}
