pub mod base;
#[cfg(feature = "claims-script")]
pub mod script;

pub use base::{ClaimsChecker, DefaultClaimsChecker};
#[cfg(feature = "claims-script")]
pub use script::ScriptClaimsChecker;

pub async fn transpile_claims_script_typescript_to_javascript(
    path: &str,
    source: &str,
) -> crate::OidcResult<String> {
    #[cfg(feature = "claims-script")]
    {
        script::transpile_claims_script_typescript_to_javascript(path, source).await
    }

    #[cfg(not(feature = "claims-script"))]
    {
        let _ = (path, source);
        Err(crate::OidcError::ClaimsCheckScriptCompile {
            message: "Claims script transpilation requires the claims-script feature to be enabled"
                .to_string(),
        })
    }
}
