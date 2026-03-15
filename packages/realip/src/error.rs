use std::path::PathBuf;

use snafu::Snafu;

pub type RealIpResult<T> = Result<T, RealIpError>;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum RealIpError {
    #[snafu(display("Invalid real-ip config: {message}"))]
    Config { message: String },

    #[snafu(display("Unknown provider kind `{kind}` for provider `{name}`"))]
    UnknownProviderKind { name: String, kind: String },

    #[snafu(display("No custom provider factory registered for kind `{kind}`"))]
    MissingProviderFactory { kind: String },

    #[snafu(display("Duplicate custom provider factory registration for kind `{kind}`"))]
    DuplicateProviderFactory { kind: String },

    #[snafu(display("Provider `{provider}` is missing required field `{field}`"))]
    MissingProviderField {
        provider: String,
        field: &'static str,
    },

    #[snafu(display("Source `{source_name}` references unknown provider `{provider}`"))]
    UnknownSourceProvider {
        source_name: String,
        provider: String,
    },

    #[snafu(display("Failed to read provider file `{:?}`: {source}", path))]
    ReadProviderFile {
        path: PathBuf,
        source: std::io::Error,
    },

    #[snafu(display("Provider command `{command}` failed: {details}"))]
    ProviderCommand { command: String, details: String },

    #[snafu(display("Provider request for `{url}` failed: {source}"))]
    ProviderHttp { url: String, source: reqwest::Error },

    #[snafu(display("Failed to watch provider path `{:?}`: {details}", path))]
    WatchProvider { path: PathBuf, details: String },

    #[snafu(display("Provider `{provider}` returned no valid CIDRs"))]
    EmptyProviderOutput { provider: String },

    #[snafu(display("Provider `{provider}` has invalid CIDR or IP entry `{entry}`"))]
    InvalidProviderEntry { provider: String, entry: String },

    #[snafu(display("Provider `{provider}` failed: {details}"))]
    ProviderLoad { provider: String, details: String },
}
