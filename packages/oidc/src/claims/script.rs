use std::path::Path;

use boa_engine::{Context, Source};
use serde::{Deserialize, Serialize};
use serde_constant::ConstBool;
use swc_core::{
    common::{FileName, GLOBALS, Globals, Mark, SourceMap, sync::Lrc},
    ecma::{
        ast::Program,
        codegen::{Config as CodegenConfig, Emitter, text_writer::JsWriter},
        parser::{Parser, StringInput, Syntax, TsSyntax},
        transforms::{base::resolver, typescript::strip},
    },
};
use tracing::debug;

use crate::{
    ClaimsCheckResult, IdTokenClaimsWithExtra, UserInfoClaimsWithExtra,
    claims::{ClaimsChecker, DefaultClaimsChecker},
    error::{OidcError, OidcResult},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptClaimsCheckSuccessResult {
    pub success: ConstBool<true>,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub claims: serde_json::Value,
}

impl From<ScriptClaimsCheckSuccessResult> for ClaimsCheckResult {
    fn from(result: ScriptClaimsCheckSuccessResult) -> Self {
        ClaimsCheckResult {
            display_name: result.display_name,
            picture: result.picture,
            claims: result.claims,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptClaimsCheckFailureResult {
    pub success: Option<ConstBool<false>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claims: Option<serde_json::Value>,
}

/// Result of OIDC claims check script.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScriptClaimsCheckResult {
    Success(ScriptClaimsCheckSuccessResult),
    Failure(ScriptClaimsCheckFailureResult),
}

pub struct ScriptClaimsChecker {
    default_checker: DefaultClaimsChecker,
    boa_compat_source: Option<String>,
}

impl ScriptClaimsChecker {
    pub async fn from_file(path: Option<&str>) -> OidcResult<Self> {
        let boa_compat_source = if let Some(path) = path {
            let mut source =
                tokio::fs::read_to_string(path)
                    .await
                    .map_err(|e| OidcError::Claims {
                        message: format!("Failed to read claims check script '{path}': {e}"),
                    })?;

            if is_typescript_script(path) {
                source = transpile_typescript_to_javascript(path, &source).await?;
            }

            let boa_compat_source = transform_script_to_boa_compat(&source);

            Some(boa_compat_source)
        } else {
            None
        };

        Ok(Self {
            default_checker: DefaultClaimsChecker,
            boa_compat_source,
        })
    }
}

impl ClaimsChecker for ScriptClaimsChecker {
    /// Execute a JS claims-check script against the given OIDC claims.
    ///
    /// This function executes the provided script using the Boa engine
    async fn check_claims(
        &self,
        id_token_claims: &IdTokenClaimsWithExtra,
        user_info_claims: Option<&UserInfoClaimsWithExtra>,
    ) -> OidcResult<ClaimsCheckResult> {
        if let Some(boa_compat_source) = &self.boa_compat_source {
            let mut context = Context::default();

            // Inject the claims as a global JSON string, then parse inside JS
            let id_token_claims_json_block = {
                let id_token_claims_json =
                    serde_json::to_string(&id_token_claims).map_err(|e| OidcError::Claims {
                        message: format!("Failed to serialize id_token_claims: {e}"),
                    })?;
                format!(r#"JSON.parse('{id_token_claims_json}')"#,)
                    .replace('\\', "\\\\")
                    .replace('\'', "\\'")
            };
            let user_info_claims_json_block = if let Some(user_info_claims) = user_info_claims {
                let user_info_claims_json =
                    serde_json::to_string(&user_info_claims).map_err(|e| OidcError::Claims {
                        message: format!("Failed to serialize user_info_claims: {e}"),
                    })?;
                format!(r#"JSON.parse('{user_info_claims_json}')"#,)
                    .replace('\\', "\\\\")
                    .replace('\'', "\\'")
            } else {
                "null".to_string()
            };

            // Build a wrapper that:
            // 1. Captures the module-like default export function
            // 2. Calls it with the parsed claims
            // 3. Returns the JSON result
            let wrapper = format!(
                r#"
                var __id_token_claims = {id_token_claims_escaped};
                var __user_info_claims = {user_info_claims_escaped};
                var __exports = {{}};
        
                // Shim: capture the default export
                {script}
        
                var __fn = __exports.default;
                if (typeof __fn !== 'function') {{
                    throw new Error('No default export function found in the script');
                }}
                var __result = __fn(__id_token_claims, __user_info_claims);
                JSON.stringify(__result);
                "#,
                id_token_claims_escaped = id_token_claims_json_block,
                user_info_claims_escaped = user_info_claims_json_block,
                script = boa_compat_source,
            );

            debug!("Running claims check script");

            let result =
                context
                    .eval(Source::from_bytes(&wrapper))
                    .map_err(|e| OidcError::Claims {
                        message: format!("Claims check script execution error: {e}"),
                    })?;

            let result_str = result.as_string().ok_or_else(|| OidcError::Claims {
                message: "Claims check script did not return a string".to_string(),
            })?;

            let check_result: ScriptClaimsCheckResult =
                serde_json::from_str(&result_str.to_std_string_escaped()).map_err(|e| {
                    OidcError::Claims {
                        message: format!("Failed to parse claims check script result: {e}"),
                    }
                })?;

            match check_result {
                ScriptClaimsCheckResult::Success(success) => Ok(success.into()),
                ScriptClaimsCheckResult::Failure(failure) => {
                    let err_msg = failure
                        .error
                        .clone()
                        .unwrap_or_else(|| "Claims check script unknown error".to_string());
                    Err(OidcError::ClaimsCheckReject { message: err_msg })
                }
            }
        } else {
            Ok(self
                .default_checker
                .check_claims(id_token_claims, user_info_claims)
                .await?)
        }
    }
}

fn transform_script_to_boa_compat(source: &str) -> String {
    source
        .replace(
            "export default async function",
            "__exports.default = async function",
        )
        .replace("export default function", "__exports.default = function")
        .replace("export default", "__exports.default =")
}

fn is_typescript_script(path: &str) -> bool {
    matches!(
        Path::new(path).extension().and_then(|ext| ext.to_str()),
        Some("ts" | "mts")
    )
}

async fn transpile_typescript_to_javascript(path: &str, source: &str) -> OidcResult<String> {
    let cm: Lrc<SourceMap> = Default::default();
    let fm = cm.new_source_file(
        FileName::Custom(path.to_string()).into(),
        source.to_string(),
    );

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
        let mut module =
            parser
                .parse_module()
                .map_err(|e| OidcError::ClaimsCheckScriptCompile {
                    message: format!("TypeScript parse failed for '{path}': {e:?}"),
                })?;

        if let Some(err) = parser.take_errors().into_iter().next() {
            return Err(OidcError::ClaimsCheckScriptCompile {
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

            emitter
                .emit_module(&module)
                .map_err(|e| OidcError::ClaimsCheckScriptCompile {
                    message: format!("TypeScript emit failed for '{path}': {e}"),
                })?;
        }

        String::from_utf8(out).map_err(|e| OidcError::ClaimsCheckScriptCompile {
            message: format!("SWC emitted non-UTF8 output for '{path}': {e}"),
        })
    })
}
