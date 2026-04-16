import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import nunjucks from "nunjucks";

export interface TemplateContext {
	[key: string]: unknown;
}

export interface RenderTemplateToFileOptions {
	templatePath: string;
	outputPath: string;
	context?: TemplateContext;
}

export function renderTemplateFile(
	templatePath: string,
	context: TemplateContext = {},
): string {
	const environment = new nunjucks.Environment(
		new nunjucks.FileSystemLoader(path.dirname(templatePath), {
			noCache: true,
		}),
		{
			autoescape: false,
			throwOnUndefined: true,
		},
	);

	return environment.render(path.basename(templatePath), context);
}

export async function renderTemplateToFile(
	options: RenderTemplateToFileOptions,
): Promise<string> {
	const rendered = renderTemplateFile(options.templatePath, options.context);
	await mkdir(path.dirname(options.outputPath), { recursive: true });
	await writeFile(options.outputPath, rendered, "utf8");
	return options.outputPath;
}
