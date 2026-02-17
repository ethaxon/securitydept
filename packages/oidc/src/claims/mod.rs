#[cfg(feature = "claims-script")]
pub mod script;

#[cfg(feature = "claims-script")]
pub use script::{check_claims_with_custom_script, load_script};
