/**
 * Rewrite a default-export script into a shape that can be executed via
 * browser async-function evaluation.
 */
export function transformScriptForBrowser(source: string): string {
	return source
		.replace(
			"export default async function",
			"__exports.default = async function",
		)
		.replace("export default function", "__exports.default = function")
		.replace("export default", "__exports.default =");
}
