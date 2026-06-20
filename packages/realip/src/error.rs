use std::{net::IpAddr, path::PathBuf};

use snafu::Snafu;

pub type RealIpResult<T> = Result<T, RealIpError>;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum RealIpError {
    #[snafu(display("Invalid real-IP config: {message}"))]
    Config { message: String },

    #[snafu(display("No custom CIDR node factory registered for kind `{kind}`"))]
    MissingCidrNodeFactory { kind: String },

    #[snafu(display("Duplicate custom CIDR node factory registration for kind `{kind}`"))]
    DuplicateCidrNodeFactory { kind: String },

    #[snafu(display("Failed to read CIDR node file `{:?}`: {source}", path))]
    ReadCidrNodeFile {
        path: PathBuf,
        source: std::io::Error,
    },

    #[snafu(display("CIDR node command `{command}` failed: {details}"))]
    CidrNodeCommand { command: String, details: String },

    #[snafu(display("CIDR node request for `{url}` failed: {source}"))]
    CidrNodeHttp { url: String, source: reqwest::Error },

    #[snafu(display("Failed to watch CIDR node path `{:?}`: {details}", path))]
    WatchCidrNode { path: PathBuf, details: String },

    #[snafu(display("CIDR node `{node}` returned no valid CIDRs"))]
    EmptyCidrNodeOutput { node: String },

    #[snafu(display("CIDR node `{node}` has invalid CIDR or IP entry `{entry}`"))]
    InvalidCidrNodeEntry { node: String, entry: String },

    #[snafu(display("CIDR node `{node}` failed: {details}"))]
    CidrNodeLoad { node: String, details: String },

    #[snafu(display("Invalid real-IP access config: {message}"))]
    AccessConfig { message: String },

    #[snafu(display("Real-IP access denied for `{client_ip}`: {reason}"))]
    AccessDenied { client_ip: IpAddr, reason: String },
}
