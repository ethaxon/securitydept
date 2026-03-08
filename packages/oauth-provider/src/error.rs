use snafu::Snafu;

pub type OAuthProviderResult<T> = Result<T, OAuthProviderError>;

#[derive(Debug, Snafu)]
#[snafu(visibility(pub))]
pub enum OAuthProviderError {
    #[snafu(display("OAuth provider configuration error: {message}"))]
    InvalidConfig { message: String },

    #[snafu(display("OAuth provider metadata error: {message}"))]
    Metadata { message: String },

    #[snafu(display("OAuth provider HTTP client error: {message}"))]
    HttpClient { message: String },

    #[snafu(display("OAuth provider introspection error: {message}"))]
    Introspection { message: String },
}

