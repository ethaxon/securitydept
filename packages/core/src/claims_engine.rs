use std::path::Path;

use boa_engine::{Context, Source};
use swc_core::common::{FileName, GLOBALS, Globals, Mark, SourceMap, sync::Lrc};
use swc_core::ecma::ast::Program;
use swc_core::ecma::codegen::{Config as CodegenConfig, Emitter, text_writer::JsWriter};
use swc_core::ecma::parser::{Parser, StringInput, Syntax, TsSyntax};
use swc_core::ecma::transforms::base::resolver;
use swc_core::ecma::transforms::typescript::strip;
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
    // 1. Captures the module-like default export function
    // 2. Calls it with the parsed claims
    // 3. Returns the JSON result
    let wrapper = format!(
        r#"
        var __claims = JSON.parse('{claims_json_escaped}');
        var __exports = {{}};

        // Shim: capture the default export
        {script}

        var __fn = __exports.default;
        if (typeof __fn !== 'function') {{
            throw new Error('No default export function found in the script');
        }}
        var __result = __fn(__claims);
        JSON.stringify(__result);
        "#,
        claims_json_escaped = claims_json.replace('\\', "\\\\").replace('\'', "\\'"),
        script = transform_script_to_boa_compat(script_source),
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

/// Rewrite `export default` to a Boa-compatible assignment shim.
fn transform_script_to_boa_compat(source: &str) -> String {
    source
        .replace(
            "export default async function",
            "__exports.default = async function",
        )
        .replace("export default function", "__exports.default = function")
        .replace("export default", "__exports.default =")
}

/// Load the claims check script from a file path.
pub async fn load_script(path: &str) -> Result<String> {
    let source = tokio::fs::read_to_string(path)
        .await
        .map_err(|e| Error::ClaimsCheck {
            message: format!("Failed to read claims check script '{path}': {e}"),
        })?;

    if is_typescript_script(path) {
        return transpile_typescript_to_javascript(path, &source).await;
    }

    Ok(source)
}

fn is_typescript_script(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|ext| ext.to_str()),
        Some("ts" | "mts")
    )
}

async fn transpile_typescript_to_javascript(path: &str, source: &str) -> Result<String> {
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(FileName::Custom(path.to_string()).into(), source.to_string());

    GLOBALS.set(&Globals::new(), || {
        let mut parser = Parser::new(
            Syntax::Typescript(TsSyntax {
                tsx: false,
                decorators: true,
                dts: false,
                no_early_errors: true,
                disallow_ambiguous_jsx_like: true,
            }),
            StringInput::from(&*fm),
            None,
        );
        let mut module = parser.parse_module().map_err(|e| Error::ClaimsCheck {
            message: format!("TypeScript parse failed for '{path}': {e:?}"),
        })?;

        if let Some(err) = parser.take_errors().into_iter().next() {
            return Err(Error::ClaimsCheck {
                message: format!("TypeScript parse failed for '{path}': {err:?}"),
            });
        }

        let unresolved_mark = Mark::new();
        let top_level_mark = Mark::new();
        let program = Program::Module(module)
            .apply(&mut resolver(unresolved_mark, top_level_mark, false))
            .apply(&mut strip(unresolved_mark, top_level_mark));
        module = match program {
            Program::Module(module) => module,
            Program::Script(_) => unreachable!("TypeScript parser returned script program"),
        };

        let mut out = Vec::new();
        {
            let mut emitter = Emitter {
                cfg: CodegenConfig::default(),
                comments: None,
                cm: cm.clone(),
                wr: JsWriter::new(cm, "\n", &mut out, None),
            };

            emitter.emit_module(&module).map_err(|e| Error::ClaimsCheck {
                message: format!("TypeScript emit failed for '{path}': {e}"),
            })?;
        }

        String::from_utf8(out).map_err(|e| Error::ClaimsCheck {
            message: format!("SWC emitted non-UTF8 output for '{path}': {e}"),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::{
        Error, run_claims_check, transform_script_to_boa_compat,
        transpile_typescript_to_javascript,
    };
    use serde_json::json;

    #[test]
    fn run_claims_check_succeeds_with_export_default_function() {
        let script = r#"
export default function (claims) {
  return {
    success: true,
    display_name: claims.sub,
    claims,
  };
}
"#;

        let claims = json!({ "sub": "user-123" });
        let result = run_claims_check(script, &claims).expect("claims check should succeed");
        assert!(result.success);
        assert_eq!(result.display_name.as_deref(), Some("user-123"));
    }

    #[test]
    fn run_claims_check_returns_failed_error_when_script_reports_failure() {
        let script = r#"
export default function (_claims) {
  return {
    success: false,
    error: "claims rejected",
  };
}
"#;

        let err = run_claims_check(script, &json!({})).expect_err("should fail");
        match err {
            Error::ClaimsCheckFailed { message } => assert_eq!(message, "claims rejected"),
            _ => panic!("unexpected error variant"),
        }
    }

    #[test]
    fn run_claims_check_returns_script_error_when_function_missing() {
        let script = "const x = 1;";
        let err = run_claims_check(script, &json!({})).expect_err("should fail");
        match err {
            Error::ClaimsCheck { message } => {
                assert!(message.contains("No default export function found"))
            }
            _ => panic!("unexpected error variant"),
        }
    }

    #[test]
    fn transform_script_rewrites_export_default() {
        let source = r#"
export default function verify(claims) {
  return { success: true, display_name: claims.sub };
}
"#;

        let transformed = transform_script_to_boa_compat(source);
        assert!(!transformed.contains("export default function"));
        assert!(transformed.contains("__exports.default = function verify(claims)"));
    }

    #[test]
    fn transpile_typescript_to_javascript_with_swc() {
        let source = r#"
export default function verify(
  claims: { sub: string }
): { success: boolean; display_name: string } {
  return { success: true, display_name: claims.sub };
}
"#;

        let runtime = tokio::runtime::Runtime::new().expect("tokio runtime should initialize");
        let output = runtime
            .block_on(transpile_typescript_to_javascript("claims.ts", source))
            .expect("TypeScript transpilation should succeed");

        assert!(!output.contains(": { sub: string }"));
        assert!(!output.contains(": { success: boolean; display_name: string }"));
        assert!(output.contains("export default function verify(claims)"));
    }
}
