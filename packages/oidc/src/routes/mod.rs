use axum::response::{IntoResponse, Redirect, Response};
use http::HeaderMap;
use serde::Deserialize;
use snafu::ResultExt;
use url::Url;

use crate::{OidcClient, OidcResult, error::RedirectUrlSnafu, models::TokenSetTrait};

#[derive(Debug, Deserialize)]
pub struct RefreshTokenPayload {
    pub refresh_token: String,
    pub redirect_uri: String,
}

pub async fn refresh_token_route(
    oidc_client: &OidcClient,
    // TODO: add headers to verify access token
    _headers: &HeaderMap,
    payload: RefreshTokenPayload,
) -> OidcResult<Response> {
    let mut redirect_uri = Url::parse(&payload.redirect_uri).context(RedirectUrlSnafu)?;

    let result = oidc_client
        .handle_token_refresh(payload.refresh_token)
        .await?;

    redirect_uri.set_fragment(Some(&result.to_fragment()));

    Ok(Redirect::to(redirect_uri.as_str()).into_response())
}
