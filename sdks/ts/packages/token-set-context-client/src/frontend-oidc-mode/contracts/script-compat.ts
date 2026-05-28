/**
 * Rewrite a default-export claims check script into a shape that can be
 * executed via browser AsyncFunction evaluation.
 *
 * Aligned with Rust `transform_script_to_boa_compat` in oidc-client claims handling.
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
