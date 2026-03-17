use std::time::Instant;

use openidconnect::{
    AccessToken, AuthUrl, ClientId, ClientSecret, DeviceAuthorizationUrl, IntrospectionUrl,
    IssuerUrl, JsonWebKeySet, JsonWebKeySetUrl, ResponseTypes, RevocationUrl, TokenUrl,
    UserInfoUrl,
    core::{
        CoreClient, CoreJsonWebKeySet, CoreResponseType, CoreSubjectIdentifierType,
        CoreTokenIntrospectionResponse,
    },
    reqwest,
};
use tokio::sync::RwLock;

use crate::{
    OAuthProviderConfig, OAuthProviderError, OAuthProviderMetadata, OAuthProviderResult,
    ProviderMetadataWithExtra, config::default_id_token_signing_alg_values_supported,
    models::ExtraProviderMetadata,
};

struct ProviderState {
    metadata: OAuthProviderMetadata,
    metadata_fetched_at: Instant,
    jwks_fetched_at: Instant,
}

pub struct OAuthProviderRuntime {
    config: OAuthProviderConfig,
    http_client: reqwest::Client,
    state: RwLock<ProviderState>,
}

impl OAuthProviderRuntime {
    pub async fn from_config(config: OAuthProviderConfig) -> OAuthProviderResult<Self> {
        config.validate()?;

        let http_client =
            reqwest::Client::builder()
                .build()
                .map_err(|e| OAuthProviderError::HttpClient {
                    message: format!("Failed to build HTTP client: {e}"),
                })?;

        let metadata = fetch_metadata(&config, &http_client).await?;
        Ok(Self {
            config,
            http_client,
            state: RwLock::new(ProviderState {
                metadata,
                metadata_fetched_at: Instant::now(),
                jwks_fetched_at: Instant::now(),
            }),
        })
    }

    pub fn http_client(&self) -> &reqwest::Client {
        &self.http_client
    }

    pub async fn metadata(&self) -> OAuthProviderResult<OAuthProviderMetadata> {
        self.ensure_metadata_and_jwks_fresh().await?;
        Ok(self.state.read().await.metadata.clone())
    }

    pub async fn oidc_provider_metadata(&self) -> OAuthProviderResult<ProviderMetadataWithExtra> {
        let metadata = self.metadata().await?;
        to_oidc_provider_metadata(&metadata)
    }

    pub async fn jwks(&self) -> OAuthProviderResult<CoreJsonWebKeySet> {
        Ok(self.metadata().await?.jwks)
    }

    pub async fn refresh_jwks(&self) -> OAuthProviderResult<OAuthProviderMetadata> {
        let jwks_uri = { self.state.read().await.metadata.jwks_uri.clone() };
        let jwks = fetch_jwks(&jwks_uri, &self.http_client).await?;

        let mut state = self.state.write().await;
        state.metadata.jwks = jwks;
        state.jwks_fetched_at = Instant::now();
        Ok(state.metadata.clone())
    }

    pub async fn refresh_metadata(&self) -> OAuthProviderResult<OAuthProviderMetadata> {
        if self.config.remote.well_known_url.is_none() {
            return Ok(self.state.read().await.metadata.clone());
        }

        let metadata = fetch_metadata(&self.config, &self.http_client).await?;
        let mut state = self.state.write().await;
        state.metadata = metadata;
        state.metadata_fetched_at = Instant::now();
        state.jwks_fetched_at = Instant::now();
        Ok(state.metadata.clone())
    }

    pub async fn introspect(
        &self,
        client_id: &str,
        client_secret: Option<&str>,
        token: &str,
        token_type_hint: Option<&str>,
    ) -> OAuthProviderResult<CoreTokenIntrospectionResponse> {
        let metadata = self.metadata().await?;
        let introspection_url = metadata.introspection_endpoint.clone().ok_or_else(|| {
            OAuthProviderError::InvalidConfig {
                message: "introspection endpoint is not configured and was not discovered"
                    .to_string(),
            }
        })?;

        let client = if let Some(client_secret) = client_secret {
            CoreClient::new(
                ClientId::new(client_id.to_string()),
                metadata.issuer.clone(),
                CoreJsonWebKeySet::new(vec![]),
            )
            .set_client_secret(ClientSecret::new(client_secret.to_string()))
            .set_introspection_url(introspection_url)
        } else {
            CoreClient::new(
                ClientId::new(client_id.to_string()),
                metadata.issuer.clone(),
                CoreJsonWebKeySet::new(vec![]),
            )
            .set_introspection_url(introspection_url)
        };

        let access_token = AccessToken::new(token.to_string());
        let mut request = client.introspect(&access_token);
        if let Some(token_type_hint) = token_type_hint {
            request = request.set_token_type_hint(token_type_hint);
        }

        request.request_async(&self.http_client).await.map_err(|e| {
            OAuthProviderError::Introspection {
                message: format!("Opaque token introspection failed: {e}"),
            }
        })
    }

    async fn ensure_metadata_and_jwks_fresh(&self) -> OAuthProviderResult<()> {
        self.ensure_metadata_fresh().await?;
        self.ensure_jwks_fresh().await
    }

    async fn ensure_metadata_fresh(&self) -> OAuthProviderResult<()> {
        if self.config.remote.metadata_refresh_interval.is_zero()
            || self.config.remote.well_known_url.is_none()
        {
            return Ok(());
        }

        let should_refresh = {
            let state = self.state.read().await;
            state.metadata_fetched_at.elapsed() >= self.config.remote.metadata_refresh_interval
        };

        if should_refresh {
            let _ = self.refresh_metadata().await?;
        }

        Ok(())
    }

    async fn ensure_jwks_fresh(&self) -> OAuthProviderResult<()> {
        if self.config.remote.jwks_refresh_interval.is_zero() {
            return Ok(());
        }

        let should_refresh = {
            let state = self.state.read().await;
            state.jwks_fetched_at.elapsed() >= self.config.remote.jwks_refresh_interval
        };

        if should_refresh {
            let _ = self.refresh_jwks().await?;
        }

        Ok(())
    }
}

async fn fetch_metadata(
    config: &OAuthProviderConfig,
    http_client: &reqwest::Client,
) -> OAuthProviderResult<OAuthProviderMetadata> {
    if let Some(well_known_url) = config.remote.well_known_url.as_deref() {
        let response = http_client.get(well_known_url).send().await.map_err(|e| {
            OAuthProviderError::Metadata {
                message: format!("Failed to fetch discovery document: {e}"),
            }
        })?;
        let body = response
            .bytes()
            .await
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Failed to read discovery document: {e}"),
            })?;

        let mut metadata: ProviderMetadataWithExtra =
            serde_json::from_slice(&body).map_err(|e| OAuthProviderError::Metadata {
                message: format!("Failed to parse discovery document: {e}"),
            })?;

        if let Some(issuer_url) = config.remote.issuer_url.as_ref() {
            metadata = metadata.set_issuer(IssuerUrl::new(issuer_url.clone()).map_err(|e| {
                OAuthProviderError::Metadata {
                    message: format!("Invalid issuer_url: {e}"),
                }
            })?);
        }
        if let Some(authorization_endpoint) = config.oidc.authorization_endpoint.as_ref() {
            metadata = metadata.set_authorization_endpoint(
                AuthUrl::new(authorization_endpoint.clone()).map_err(|e| {
                    OAuthProviderError::Metadata {
                        message: format!("Invalid authorization_endpoint: {e}"),
                    }
                })?,
            );
        }
        if let Some(token_endpoint) = config.oidc.token_endpoint.as_ref() {
            metadata =
                metadata.set_token_endpoint(Some(TokenUrl::new(token_endpoint.clone()).map_err(
                    |e| OAuthProviderError::Metadata {
                        message: format!("Invalid token_endpoint: {e}"),
                    },
                )?));
        }
        if let Some(userinfo_endpoint) = config.oidc.userinfo_endpoint.as_ref() {
            metadata = metadata.set_userinfo_endpoint(Some(
                UserInfoUrl::new(userinfo_endpoint.clone()).map_err(|e| {
                    OAuthProviderError::Metadata {
                        message: format!("Invalid userinfo_endpoint: {e}"),
                    }
                })?,
            ));
        }
        if let Some(jwks_uri) = config.remote.jwks_uri.as_ref() {
            metadata =
                metadata.set_jwks_uri(JsonWebKeySetUrl::new(jwks_uri.clone()).map_err(|e| {
                    OAuthProviderError::Metadata {
                        message: format!("Invalid jwks_uri: {e}"),
                    }
                })?);
        }
        if let Some(introspection_endpoint) = config.oidc.introspection_endpoint.as_ref() {
            metadata.additional_metadata_mut().introspection_endpoint =
                Some(introspection_endpoint.clone());
        }
        if let Some(revocation_endpoint) = config.oidc.revocation_endpoint.as_ref() {
            metadata.additional_metadata_mut().revocation_endpoint =
                Some(revocation_endpoint.clone());
        }
        if let Some(device_authorization_endpoint) =
            config.oidc.device_authorization_endpoint.as_ref()
        {
            metadata
                .additional_metadata_mut()
                .device_authorization_endpoint = Some(device_authorization_endpoint.clone());
        }
        if let Some(token_endpoint_auth_methods_supported) =
            config.oidc.token_endpoint_auth_methods_supported.as_ref()
        {
            metadata = metadata.set_token_endpoint_auth_methods_supported(Some(
                token_endpoint_auth_methods_supported.clone(),
            ));
        }
        if let Some(id_token_signing_alg_values_supported) =
            config.oidc.id_token_signing_alg_values_supported.as_ref()
        {
            metadata = metadata.set_id_token_signing_alg_values_supported(
                id_token_signing_alg_values_supported.clone(),
            );
        }
        if let Some(userinfo_signing_alg_values_supported) =
            config.oidc.userinfo_signing_alg_values_supported.as_ref()
        {
            metadata = metadata.set_userinfo_signing_alg_values_supported(Some(
                userinfo_signing_alg_values_supported.clone(),
            ));
        }

        let jwks = fetch_jwks(metadata.jwks_uri(), http_client).await?;
        return from_provider_metadata(metadata.set_jwks(jwks));
    }

    let issuer =
        IssuerUrl::new(config.remote.issuer_url.clone().unwrap_or_default()).map_err(|e| {
            OAuthProviderError::Metadata {
                message: format!("Invalid issuer_url: {e}"),
            }
        })?;
    let jwks_uri = JsonWebKeySetUrl::new(config.remote.jwks_uri.clone().unwrap_or_default())
        .map_err(|e| OAuthProviderError::Metadata {
            message: format!("Invalid jwks_uri: {e}"),
        })?;
    let jwks = fetch_jwks(&jwks_uri, http_client).await?;

    Ok(OAuthProviderMetadata {
        issuer,
        authorization_endpoint: config
            .oidc
            .authorization_endpoint
            .as_ref()
            .map(|value| AuthUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid authorization_endpoint: {e}"),
            })?,
        token_endpoint: config
            .oidc
            .token_endpoint
            .as_ref()
            .map(|value| TokenUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid token_endpoint: {e}"),
            })?,
        userinfo_endpoint: config
            .oidc
            .userinfo_endpoint
            .as_ref()
            .map(|value| UserInfoUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid userinfo_endpoint: {e}"),
            })?,
        introspection_endpoint: config
            .oidc
            .introspection_endpoint
            .as_ref()
            .map(|value| IntrospectionUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid introspection_endpoint: {e}"),
            })?,
        revocation_endpoint: config
            .oidc
            .revocation_endpoint
            .as_ref()
            .map(|value| RevocationUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid revocation_endpoint: {e}"),
            })?,
        device_authorization_endpoint: config
            .oidc
            .device_authorization_endpoint
            .as_ref()
            .map(|value| DeviceAuthorizationUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid device_authorization_endpoint: {e}"),
            })?,
        jwks_uri,
        jwks,
        token_endpoint_auth_methods_supported: config
            .oidc
            .token_endpoint_auth_methods_supported
            .clone(),
        response_types_supported: vec![ResponseTypes::new(vec![CoreResponseType::Code])],
        subject_types_supported: vec![CoreSubjectIdentifierType::Public],
        id_token_signing_alg_values_supported: config
            .oidc
            .id_token_signing_alg_values_supported
            .clone()
            .unwrap_or_else(default_id_token_signing_alg_values_supported),
        userinfo_signing_alg_values_supported: config
            .oidc
            .userinfo_signing_alg_values_supported
            .clone(),
        additional_metadata: ExtraProviderMetadata {
            introspection_endpoint: config.oidc.introspection_endpoint.clone(),
            revocation_endpoint: config.oidc.revocation_endpoint.clone(),
            device_authorization_endpoint: config.oidc.device_authorization_endpoint.clone(),
            extra: Default::default(),
        },
    })
}

fn from_provider_metadata(
    metadata: ProviderMetadataWithExtra,
) -> OAuthProviderResult<OAuthProviderMetadata> {
    Ok(OAuthProviderMetadata {
        issuer: metadata.issuer().clone(),
        authorization_endpoint: Some(metadata.authorization_endpoint().clone()),
        token_endpoint: metadata.token_endpoint().cloned(),
        userinfo_endpoint: metadata.userinfo_endpoint().cloned(),
        introspection_endpoint: metadata
            .additional_metadata()
            .introspection_endpoint
            .as_ref()
            .map(|value| IntrospectionUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid introspection_endpoint: {e}"),
            })?,
        revocation_endpoint: metadata
            .additional_metadata()
            .revocation_endpoint
            .as_ref()
            .map(|value| RevocationUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid revocation_endpoint: {e}"),
            })?,
        device_authorization_endpoint: metadata
            .additional_metadata()
            .device_authorization_endpoint
            .as_ref()
            .map(|value| DeviceAuthorizationUrl::new(value.clone()))
            .transpose()
            .map_err(|e| OAuthProviderError::Metadata {
                message: format!("Invalid device_authorization_endpoint: {e}"),
            })?,
        jwks_uri: metadata.jwks_uri().clone(),
        jwks: metadata.jwks().clone(),
        token_endpoint_auth_methods_supported: metadata
            .token_endpoint_auth_methods_supported()
            .cloned(),
        response_types_supported: metadata.response_types_supported().clone(),
        subject_types_supported: metadata.subject_types_supported().clone(),
        id_token_signing_alg_values_supported: metadata
            .id_token_signing_alg_values_supported()
            .clone(),
        userinfo_signing_alg_values_supported: metadata
            .userinfo_signing_alg_values_supported()
            .cloned(),
        additional_metadata: metadata.additional_metadata().clone(),
    })
}

fn to_oidc_provider_metadata(
    metadata: &OAuthProviderMetadata,
) -> OAuthProviderResult<ProviderMetadataWithExtra> {
    let authorization_endpoint = metadata.authorization_endpoint.clone().ok_or_else(|| {
        OAuthProviderError::InvalidConfig {
            message: "authorization_endpoint is required to build an OIDC client".to_string(),
        }
    })?;

    Ok(ProviderMetadataWithExtra::new(
        metadata.issuer.clone(),
        authorization_endpoint,
        metadata.jwks_uri.clone(),
        metadata.response_types_supported.clone(),
        metadata.subject_types_supported.clone(),
        metadata.id_token_signing_alg_values_supported.clone(),
        metadata.additional_metadata.clone(),
    )
    .set_jwks(metadata.jwks.clone())
    .set_token_endpoint(metadata.token_endpoint.clone())
    .set_userinfo_endpoint(metadata.userinfo_endpoint.clone())
    .set_token_endpoint_auth_methods_supported(
        metadata.token_endpoint_auth_methods_supported.clone(),
    )
    .set_userinfo_signing_alg_values_supported(
        metadata.userinfo_signing_alg_values_supported.clone(),
    ))
}

async fn fetch_jwks(
    jwks_uri: &JsonWebKeySetUrl,
    http_client: &reqwest::Client,
) -> OAuthProviderResult<CoreJsonWebKeySet> {
    JsonWebKeySet::fetch_async(jwks_uri, http_client)
        .await
        .map_err(|e| OAuthProviderError::Metadata {
            message: format!("Failed to fetch JWKS: {e}"),
        })
}

#[cfg(test)]
mod tests {
    use openidconnect::{
        AuthUrl, IssuerUrl, JsonWebKeySetUrl, ProviderMetadata, ResponseTypes,
        core::{
            CoreJsonWebKeySet, CoreJwsSigningAlgorithm, CoreResponseType, CoreSubjectIdentifierType,
        },
    };

    use super::from_provider_metadata;
    use crate::{ExtraProviderMetadata, OAuthProviderError, ProviderMetadataWithExtra};

    #[test]
    fn from_provider_metadata_rejects_invalid_discovery_override_urls() {
        let metadata: ProviderMetadataWithExtra = ProviderMetadata::new(
            IssuerUrl::new("https://issuer.example.com".to_string()).expect("issuer should parse"),
            AuthUrl::new("https://issuer.example.com/authorize".to_string())
                .expect("auth url should parse"),
            JsonWebKeySetUrl::new("https://issuer.example.com/jwks".to_string())
                .expect("jwks uri should parse"),
            vec![ResponseTypes::new(vec![CoreResponseType::Code])],
            vec![CoreSubjectIdentifierType::Public],
            vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256],
            ExtraProviderMetadata {
                introspection_endpoint: Some("not-a-url".to_string()),
                ..Default::default()
            },
        )
        .set_jwks(CoreJsonWebKeySet::new(vec![]));

        let error = from_provider_metadata(metadata).expect_err("invalid endpoint should fail");
        match error {
            OAuthProviderError::Metadata { message } => {
                assert!(message.contains("Invalid introspection_endpoint"));
            }
            other => panic!("unexpected error: {other}"),
        }
    }
}
