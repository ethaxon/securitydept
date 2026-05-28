export const SECURITYDEPT_COMPAT_FRAGMENT_VERSION = "v1";

export type CompatFragmentParameters = Record<string, string>;

export interface CompatFragment {
	payload: string;
	parameters: CompatFragmentParameters;
}

export interface AppendOrReplaceCompatFragmentOptions {
	payload: string | URLSearchParams;
}

export function appendOrReplaceCompatFragment(
	url: URL,
	options: AppendOrReplaceCompatFragmentOptions,
): URL {
	const blocks = splitFragmentBlocks(url.hash);
	if (isCompatFragmentBlock(blocks.at(-1) ?? "")) {
		blocks.pop();
	}
	blocks.push(buildCompatFragmentBlock(options));
	url.hash = blocks.join("#");
	return url;
}

export function parseCompatFragment(
	input: URL | string,
): CompatFragment | null {
	const fragment = input instanceof URL ? input.hash : input;
	const block = splitFragmentBlocks(fragment).at(-1);
	if (!block || !isCompatFragmentBlock(block)) {
		return null;
	}

	const blockParameters = new URLSearchParams(block);
	blockParameters.delete("securitydept");
	const parameters: CompatFragmentParameters = {};
	blockParameters.forEach((value, key) => {
		parameters[key] = value;
	});
	return {
		payload: blockParameters.toString(),
		parameters,
	};
}

export function removeCompatFragment(url: URL): CompatFragment | null {
	const blocks = splitFragmentBlocks(url.hash);
	const block = blocks.at(-1);
	if (!block) {
		return null;
	}
	const parsed = parseCompatFragment(block);
	if (!parsed) {
		return null;
	}
	blocks.pop();
	url.hash = blocks.length > 0 ? blocks.join("#") : "";
	return parsed;
}

export function isCompatFragmentBlock(block: string): boolean {
	return (
		new URLSearchParams(block.startsWith("#") ? block.slice(1) : block).get(
			"securitydept",
		) === SECURITYDEPT_COMPAT_FRAGMENT_VERSION
	);
}

function splitFragmentBlocks(fragment: string): string[] {
	const normalized = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	return normalized ? normalized.split("#") : [];
}

function buildCompatFragmentBlock(
	options: AppendOrReplaceCompatFragmentOptions,
): string {
	const block = new URLSearchParams();
	block.set("securitydept", SECURITYDEPT_COMPAT_FRAGMENT_VERSION);
	const payload =
		typeof options.payload === "string"
			? new URLSearchParams(
					options.payload.startsWith("#")
						? options.payload.slice(1)
						: options.payload,
				)
			: options.payload;
	for (const [key, value] of payload) {
		if (key !== "securitydept") {
			block.append(key, value);
		}
	}
	return block.toString();
}
