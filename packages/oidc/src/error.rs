use snafu::Snafu;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum OidcError {
    #[snafu(display("OIDC metadata error: {message}"))]
    Metadata { message: String },

    #[snafu(display("OIDC token exchange error: {message}"))]
    TokenExchange { message: String },

    #[snafu(display("OIDC redirect URL error: {source}"), context(false))]
    RedirectUrl { source: url::ParseError },

    #[snafu(display("OIDC claims error: {message}"))]
    Claims { message: String },

    #[snafu(display("Claims check script error: {message}"))]
    ClaimsCheck { message: String },

    #[snafu(display("Claims check script failed: {message}"))]
    ClaimsCheckFailed { message: String },

    #[snafu(display("Invalid configuration: {message}"))]
    InvalidConfig { message: String },
}

pub type OidcResult<T> = std::result::Result<T, OidcError>;
