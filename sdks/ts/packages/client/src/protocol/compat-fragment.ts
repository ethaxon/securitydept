import { type UriFragmentPart } from "../struct/uri-string";

export const SECURITYDEPT_COMPAT_FRAGMENT_VERSION = "v1";

export type CompatFragmentParameters = Record<string, string>;

export interface CompatFragment {
	payload: string;
	parameters: CompatFragmentParameters;
}

export interface AppendOrReplaceCompatFragmentOptions {
	payload: string | URLSearchParams | CompatFragmentParameters;
}

export interface TakeCompatFragmentResult<T> {
	compatFragment: CompatFragment | null;
	fragment: string;
	url: UpdatedUriFragment<T>;
}

export interface TakeCompatFragmentOptions<T> {
	condition?: (compatFragment: CompatFragment) => boolean;
	update: UpdateUriFragmentHash<T>;
}

export interface AppendOrReplaceCompatFragmentResult<T> {
	fragment: string;
	url: UpdatedUriFragment<T>;
}

export type UpdatedUriFragment<T> = T extends string ? string : T;

export type UpdateUriFragmentHash<T> = (
	input: T,
	hash: string,
) => UpdatedUriFragment<T>;

export function appendOrReplaceCompatFragment<
	T extends string | UriFragmentPart,
>(
	input: T,
	options: AppendOrReplaceCompatFragmentOptions,
	update: UpdateUriFragmentHash<T>,
): AppendOrReplaceCompatFragmentResult<T> {
	const blocks = splitFragmentBlocks(readUriFragmentHash(input));
	if (isCompatFragmentBlock(blocks.at(-1) ?? "")) {
		blocks.pop();
	}
	blocks.push(buildCompatFragmentBlock(options));
	const fragment = joinFragmentBlocks(blocks);
	return {
		fragment,
		url: update(input, fragment),
	};
}

export function parseCompatFragment(
	input: string | UriFragmentPart,
): CompatFragment | null {
	const fragment = readUriFragmentHash(input);
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

export function takeCompatFragment<T extends string | UriFragmentPart>(
	input: T,
	options: TakeCompatFragmentOptions<T>,
): TakeCompatFragmentResult<T> {
	const currentFragment = readUriFragmentHash(input);
	const blocks = splitFragmentBlocks(currentFragment);
	const block = blocks.at(-1);
	if (!block || !isCompatFragmentBlock(block)) {
		return {
			compatFragment: null,
			fragment: currentFragment,
			url: input as UpdatedUriFragment<T>,
		};
	}

	const compatFragment = parseCompatFragment(block);
	if (
		!compatFragment ||
		(options.condition && !options.condition(compatFragment))
	) {
		return {
			compatFragment: null,
			fragment: currentFragment,
			url: input as UpdatedUriFragment<T>,
		};
	}
	blocks.pop();
	const fragment = joinFragmentBlocks(blocks);
	return {
		compatFragment,
		fragment,
		url: options.update(input, fragment),
	};
}

export function isCompatFragmentBlock(block: string): boolean {
	return (
		new URLSearchParams(block.startsWith("#") ? block.slice(1) : block).get(
			"securitydept",
		) === SECURITYDEPT_COMPAT_FRAGMENT_VERSION
	);
}

function readUriFragmentHash(input: string | UriFragmentPart): string {
	if (typeof input === "string") {
		return input.startsWith("#") ? input : `#${input}`;
	}
	return input.hash;
}

function joinFragmentBlocks(blocks: string[]): string {
	return blocks.length > 0 ? `#${blocks.join("#")}` : "";
}

function splitFragmentBlocks(fragment: string): string[] {
	// Lone `#` is an empty hash-route block; distinct from no hash (`""`).
	if (fragment === "#") {
		return [""];
	}
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
			: new URLSearchParams(options.payload);
	for (const [key, value] of payload) {
		if (key !== "securitydept") {
			block.append(key, value);
		}
	}
	return block.toString();
}
