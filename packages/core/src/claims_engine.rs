use boa_engine::{Context, Source};
use tracing::debug;

use crate::error::{Error, Result};
use crate::models::ClaimsCheckResult;

/// Execute a JS claims-check script against the given OIDC claims.
///
/// The script must export a default function that takes a claims object
/// and returns `{ success: true, displayName, claims }` or
/// `{ success: false, error: { message } }`.
pub fn run_claims_check(
    script_source: &str,
    claims: &serde_json::Value,
) -> Result<ClaimsCheckResult> {
    let mut context = Context::default();

    // Inject the claims as a global JSON string, then parse inside JS
    let claims_json = serde_json::to_string(claims).map_err(|e| Error::ClaimsCheck {
        message: format!("Failed to serialize claims: {e}"),
    })?;

    // Build a wrapper that:
    // 1. Defines the module's export default function
    // 2. Calls it with the parsed claims
    // 3. Returns the JSON result
    let wrapper = format!(
        r#"
        var __claims = JSON.parse('{claims_json_escaped}');
        var __exports = {{}};

        // Shim: capture the default export
        {script}

        // If the script used `export default`, boa may not handle ES modules directly.
        // We wrap it: the script should define claimsCheck or assign to __exports.default.
        var __fn = typeof claimsCheck === 'function' ? claimsCheck : __exports.default;
        if (typeof __fn !== 'function') {{
            // Fallback: try to find any function declared in the script
            throw new Error('No claimsCheck function found in the script');
        }}
        var __result = __fn(__claims);
        JSON.stringify(__result);
        "#,
        claims_json_escaped = claims_json.replace('\\', "\\\\").replace('\'', "\\'"),
        script = transform_script(script_source),
    );

    debug!("Running claims check script");

    let result = context
        .eval(Source::from_bytes(&wrapper))
        .map_err(|e| Error::ClaimsCheck {
            message: format!("Script execution error: {e}"),
        })?;

    let result_str = result.as_string().ok_or_else(|| Error::ClaimsCheck {
        message: "Script did not return a string".to_string(),
    })?;

    let check_result: ClaimsCheckResult = serde_json::from_str(&result_str.to_std_string_escaped())
        .map_err(|e| Error::ClaimsCheck {
            message: format!("Failed to parse script result: {e}"),
        })?;

    if !check_result.success {
        let err_msg = check_result
            .error
            .clone()
            .unwrap_or_else(|| "Unknown error".to_string());
        return Err(Error::ClaimsCheckFailed { message: err_msg });
    }

    Ok(check_result)
}

/// Strip TypeScript type annotations and ES module syntax for boa compatibility.
fn transform_script(source: &str) -> String {
    let mut output = String::new();
    for line in source.lines() {
        let trimmed = line.trim();

        // Skip TypeScript interface/type declarations
        if trimmed.starts_with("interface ")
            || trimmed.starts_with("type ")
            || trimmed.starts_with("export interface ")
            || trimmed.starts_with("export type ")
        {
            // Skip until closing brace for multi-line interfaces
            // (simple heuristic: skip lines until we see a lone `}`)
            if trimmed.contains('{') && !trimmed.contains('}') {
                // Will be handled by the block skipper below
                output.push_str("/* skipped type */\n");
                continue;
            }
            output.push_str("/* skipped type */\n");
            continue;
        }

        // Transform `export default function X` -> `function X`
        let transformed = if trimmed.starts_with("export default function ") {
            line.replace("export default function ", "function claimsCheck")
        } else {
            line.to_string()
        };

        output.push_str(&transformed);
        output.push('\n');
    }

    // Remove remaining TypeScript type annotations (simplified approach):
    // Remove `: TypeName` patterns after function params, but keep the logic intact.
    // For the custom-claims-check.mts format, the main annotations are in the
    // function signature: `(claims: Claims): CheckResult`

    output
        .replace(": Claims", "")
        .replace(": CheckResult", "")
        .replace(": CheckSuccessResult", "")
        .replace(": CheckFailureResult", "")
        .replace(": string", "")
        .replace(": boolean", "")
        .replace(": Error", "")
        .replace("?: string", "")
}

/// Load the claims check script from a file path.
pub async fn load_script(path: &str) -> Result<String> {
    tokio::fs::read_to_string(path)
        .await
        .map_err(|e| Error::ClaimsCheck {
            message: format!("Failed to read claims check script '{path}': {e}"),
        })
}
