use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum Error {
    #[snafu(display("Failed to read config file: {source}"))]
    ConfigRead {
        source: std::io::Error,
    },

    #[snafu(display("Failed to parse config: {source}"))]
    ConfigParse {
        source: toml::de::Error,
    },

    #[snafu(display("Failed to read data file: {source}"))]
    DataRead {
        source: std::io::Error,
    },

    #[snafu(display("Failed to write data file: {source}"))]
    DataWrite {
        source: std::io::Error,
    },

    #[snafu(display("Failed to parse data: {source}"))]
    DataParse {
        source: serde_json::Error,
    },

    #[snafu(display("Failed to serialize data: {source}"))]
    DataSerialize {
        source: serde_json::Error,
    },

    #[snafu(display("Entry not found: {id}"))]
    EntryNotFound {
        id: String,
    },

    #[snafu(display("Group not found: {id}"))]
    GroupNotFound {
        id: String,
    },

    #[snafu(display("Duplicate entry name: {name}"))]
    DuplicateEntryName {
        name: String,
    },

    #[snafu(display("Duplicate group name: {name}"))]
    DuplicateGroupName {
        name: String,
    },

    #[snafu(display("OIDC discovery error: {message}"))]
    OidcDiscovery {
        message: String,
    },

    #[snafu(display("OIDC token exchange error: {message}"))]
    OidcTokenExchange {
        message: String,
    },

    #[snafu(display("OIDC claims error: {message}"))]
    OidcClaims {
        message: String,
    },

    #[snafu(display("Claims check script error: {message}"))]
    ClaimsCheck {
        message: String,
    },

    #[snafu(display("Claims check script failed: {message}"))]
    ClaimsCheckFailed {
        message: String,
    },

    #[snafu(display("Password hashing error: {message}"))]
    PasswordHash {
        message: String,
    },

    #[snafu(display("Authentication failed"))]
    AuthFailed,

    #[snafu(display("Session not found"))]
    SessionNotFound,

    #[snafu(display("Session expired"))]
    SessionExpired,

    #[snafu(display("Invalid configuration: {message}"))]
    InvalidConfig {
        message: String,
    },
}

pub type Result<T> = std::result::Result<T, Error>;
