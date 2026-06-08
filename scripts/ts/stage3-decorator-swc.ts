import path from "node:path";
import { swc } from "@rollup/plugin-swc";

export interface CreateStage3DecoratorSwcPluginOptions {
	readonly roots: readonly string[];
}

export function createStage3DecoratorSwcPlugin(
	options: CreateStage3DecoratorSwcPluginOptions,
): ReturnType<typeof swc> {
	return swc({
		include: options.roots.map(
			(root) => `${path.resolve(root).replaceAll(path.sep, "/")}/**/*.ts`,
		),
		exclude: [/\.d\.[cm]?ts$/],
		swc: {
			jsc: {
				target: "es2022",
				loose: false,
				parser: {
					syntax: "typescript",
					decorators: true,
					tsx: false,
				},
				transform: {
					decoratorVersion: "2023-11",
					legacyDecorator: false,
					decoratorMetadata: false,
				},
			},
		},
	});
}
