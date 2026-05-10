import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import type Dockerode from "dockerode";

const require = createRequire(import.meta.url);
const Docker = require("dockerode") as typeof Dockerode;

const testLabelKey = "securitydept.test";
const testLabelValue = "true";
const testResourceLabelKey = "securitydept.test.resource";
const testLabel = `${testLabelKey}=${testLabelValue}`;

type RuntimeImage = {
	source: string;
	target: string;
	resource: string;
};

const runtimeImages: RuntimeImage[] = [
	{
		source: "kindest/node:v1.31.2",
		target: "securitydept-test/kindest-node:v1.31.2",
		resource: "realip-kube-kind-node-image",
	},
	{
		source: "rancher/k3s:v1.31.4-k3s1",
		target: "securitydept-test/rancher-k3s:v1.31.4-k3s1",
		resource: "realip-kube-k3s-image",
	},
];
const helperImage = {
	target: "securitydept-realip-kube-integration-test-helper:v1",
	resource: "realip-kube-helper-image",
} as const;

const docker = new Docker();

export async function buildKubeTestRuntimeImages(): Promise<void> {
	for (const image of runtimeImages) {
		await buildLabeledRuntimeImage(image);
	}
}

export async function buildKubeTestHelperImage(): Promise<void> {
	await buildKubeTestRuntimeImages();
	await buildImageFromContext({
		context: path.resolve("packages/realip/tests/fixtures/kube-helper"),
		src: ["Dockerfile"],
		tag: helperImage.target,
		labels: {
			[testLabelKey]: testLabelValue,
			[testResourceLabelKey]: helperImage.resource,
		},
	});
}

export async function ensureKubeTestHelperImage(): Promise<void> {
	for (const image of runtimeImages) {
		if (await hasExpectedTestImage(image.target, image.resource)) {
			continue;
		}
		await buildLabeledRuntimeImage(image);
	}

	if (await hasExpectedTestImage(helperImage.target, helperImage.resource)) {
		return;
	}
	await buildImageFromContext({
		context: path.resolve("packages/realip/tests/fixtures/kube-helper"),
		src: ["Dockerfile"],
		tag: helperImage.target,
		labels: {
			[testLabelKey]: testLabelValue,
			[testResourceLabelKey]: helperImage.resource,
		},
	});
}

export async function cleanKubeTestArtifacts(): Promise<void> {
	await removeContainersByLabel();
	await removeContainersByNamePrefix("securitydept-test-kind-");
	await removeContainersByNamePrefix("k3d-securitydept-test-k3d-");
	await removeNetworksByLabel();
	await removeNetworksByNamePrefix("k3d-securitydept-test-k3d-");
	await removeVolumesByPattern(/^k3d-securitydept-test-k3d-.*-images$/u);
}

export async function cleanKubeTestImages(): Promise<void> {
	await cleanKubeTestArtifacts();
	await removeImagesByLabel();
}

async function buildLabeledRuntimeImage(image: RuntimeImage): Promise<void> {
	const tempDir = mkdtempSync(
		path.join(os.tmpdir(), "securitydept-test-image-"),
	);
	try {
		writeFileSync(
			path.join(tempDir, "Dockerfile"),
			[
				`FROM ${image.source}`,
				`LABEL ${testLabelKey}="${testLabelValue}" ${testResourceLabelKey}="${image.resource}"`,
				"",
			].join("\n"),
		);
		await buildImageFromContext({
			context: tempDir,
			src: ["Dockerfile"],
			tag: image.target,
		});
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

async function hasExpectedTestImage(
	imageRef: string,
	resource: string,
): Promise<boolean> {
	try {
		const image = await docker.getImage(imageRef).inspect();
		return (
			image.Config.Labels?.[testLabelKey] === testLabelValue &&
			image.Config.Labels?.[testResourceLabelKey] === resource
		);
	} catch (error) {
		if (isDockerNotFoundError(error)) {
			return false;
		}
		throw error;
	}
}

type BuildImageFromContextOptions = {
	context: string;
	src: string[];
	tag: string;
	labels?: Record<string, string>;
};

async function buildImageFromContext(
	options: BuildImageFromContextOptions,
): Promise<void> {
	const stream = await docker.buildImage(
		{
			context: options.context,
			src: options.src,
		},
		{
			t: options.tag,
			labels: options.labels,
			rm: true,
			forcerm: true,
		},
	);
	await consumeDockerStream(stream, `docker build ${options.tag}`);
}

function consumeDockerStream(
	stream: NodeJS.ReadableStream,
	description: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let buffered = "";
		let streamError: Error | undefined;
		let ended = false;

		stream.on("data", (chunk: Buffer | string) => {
			buffered += chunk.toString();
			const lines = buffered.split(/\r?\n/u);
			buffered = lines.pop() ?? "";
			for (const line of lines) {
				const parsed = parseDockerJsonLine(line);
				if (!parsed) {
					continue;
				}
				writeDockerProgress(parsed);
				if (typeof parsed.error === "string") {
					streamError = new Error(parsed.error);
				}
			}
		});
		stream.on("error", reject);
		stream.on("end", () => {
			ended = true;
			if (streamError) {
				reject(streamError);
				return;
			}
			resolve();
		});
		stream.on("close", () => {
			if (ended) {
				return;
			}
			reject(new Error(`${description} stream closed before completion.`));
		});
	});
}

type DockerJsonLine = {
	stream?: string;
	status?: string;
	progress?: string;
	error?: string;
};

function parseDockerJsonLine(line: string): DockerJsonLine | undefined {
	if (line.trim().length === 0) {
		return undefined;
	}
	try {
		return JSON.parse(line) as DockerJsonLine;
	} catch {
		process.stdout.write(`${line}\n`);
		return undefined;
	}
}

function writeDockerProgress(line: DockerJsonLine): void {
	if (line.stream) {
		process.stdout.write(line.stream);
		return;
	}
	if (line.status) {
		process.stdout.write(
			`${line.status}${line.progress ? ` ${line.progress}` : ""}\n`,
		);
	}
}

async function removeContainersByLabel(): Promise<void> {
	const containers = await docker.listContainers({
		all: true,
		filters: { label: [testLabel] },
	});
	await removeContainers(containers);
}

async function removeContainersByNamePrefix(prefix: string): Promise<void> {
	const containers = await docker.listContainers({ all: true });
	await removeContainers(
		containers.filter((container) =>
			container.Names.some(
				(name) => name === `/${prefix}` || name.startsWith(`/${prefix}`),
			),
		),
	);
}

async function removeContainers(
	containers: Dockerode.ContainerInfo[],
): Promise<void> {
	for (const container of containers) {
		await ignoreMissingDockerResource(() =>
			docker.getContainer(container.Id).remove({ force: true }),
		);
	}
}

async function removeNetworksByLabel(): Promise<void> {
	const networks = await docker.listNetworks({
		filters: { label: [testLabel] },
	});
	for (const network of networks) {
		await ignoreMissingDockerResource(() =>
			docker.getNetwork(network.Id).remove(),
		);
	}
}

async function removeNetworksByNamePrefix(prefix: string): Promise<void> {
	const networks = await docker.listNetworks();
	for (const network of networks) {
		if (network.Name.startsWith(prefix)) {
			await ignoreMissingDockerResource(() =>
				docker.getNetwork(network.Id).remove(),
			);
		}
	}
}

async function removeVolumesByPattern(pattern: RegExp): Promise<void> {
	const { Volumes = [] } = await docker.listVolumes();
	for (const volume of Volumes) {
		if (pattern.test(volume.Name)) {
			await ignoreMissingDockerResource(() =>
				docker.getVolume(volume.Name).remove(),
			);
		}
	}
}

async function removeImagesByLabel(): Promise<void> {
	const images = await docker.listImages({
		all: true,
		filters: { label: [testLabel] },
	});
	for (const image of sortImagesForRemoval(images)) {
		await ignoreMissingDockerResource(() =>
			docker.getImage(image.Id).remove({ force: true }),
		);
	}
}

function sortImagesForRemoval(
	images: Dockerode.ImageInfo[],
): Dockerode.ImageInfo[] {
	return images.toSorted((left, right) => {
		const leftTagged = hasRepoTag(left);
		const rightTagged = hasRepoTag(right);
		if (leftTagged !== rightTagged) {
			return leftTagged ? -1 : 1;
		}
		return right.Created - left.Created;
	});
}

function hasRepoTag(image: Dockerode.ImageInfo): boolean {
	return (
		image.RepoTags?.some((tag) => tag.length > 0 && tag !== "<none>:<none>") ??
		false
	);
}

async function ignoreMissingDockerResource(
	operation: () => Promise<unknown>,
): Promise<void> {
	try {
		await operation();
	} catch (error) {
		if (!isDockerNotFoundError(error)) {
			throw error;
		}
	}
}

function isDockerNotFoundError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"statusCode" in error &&
		error.statusCode === 404
	);
}
