use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use typed_builder::TypedBuilder;
use url::form_urlencoded;

use crate::{
    AuthTokenDelta, AuthTokenSnapshot, CurrentAuthStateMetadataSnapshotPartial,
    MetadataRedemptionId, PendingAuthStateMetadataRedemptionPayload, SealedRefreshMaterial,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenRefreshPayload {
    #[serde(rename = "refresh_token")]
    pub refresh_material: SealedRefreshMaterial,
    #[serde(
        rename = "redirect_uri",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub token_set_redirect_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_metadata_snapshot: Option<CurrentAuthStateMetadataSnapshotPartial>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct TokenSetAuthorizeQuery {
    #[serde(default)]
    pub redirect_uri: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetadataRedemptionRequest {
    pub metadata_redemption_id: MetadataRedemptionId,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MetadataRedemptionResponse {
    pub metadata: PendingAuthStateMetadataRedemptionPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthTokenSnapshotRedirectFragment {
    #[builder(setter(into))]
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub id_token: Option<String>,
    #[serde(rename = "refresh_token", skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub refresh_material: Option<SealedRefreshMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub access_token_expires_at: Option<DateTime<Utc>>,
    #[builder(setter(into))]
    pub metadata_redemption_id: MetadataRedemptionId,
}

impl AuthTokenSnapshotRedirectFragment {
    pub fn from_snapshot(
        snapshot: &AuthTokenSnapshot,
        metadata_redemption_id: MetadataRedemptionId,
    ) -> Self {
        Self {
            access_token: snapshot.access_token.clone(),
            id_token: snapshot.id_token.clone(),
            refresh_material: snapshot.refresh_material.clone(),
            access_token_expires_at: snapshot.access_token_expires_at,
            metadata_redemption_id,
        }
    }

    pub fn to_fragment(&self) -> String {
        let mut fragment = form_urlencoded::Serializer::new(String::new());

        fragment.append_pair("access_token", &self.access_token);

        if let Some(refresh_material) = self.refresh_material.as_ref() {
            fragment.append_pair("refresh_token", refresh_material.expose());
        }

        if let Some(id_token) = self.id_token.as_deref() {
            fragment.append_pair("id_token", id_token);
        }

        if let Some(access_token_expiration) = self.access_token_expires_at.as_ref() {
            fragment.append_pair("expires_at", &access_token_expiration.to_rfc3339());
        }

        fragment.append_pair(
            "metadata_redemption_id",
            self.metadata_redemption_id.expose(),
        );

        fragment.finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct AuthTokenDeltaRedirectFragment {
    #[builder(setter(into))]
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option, into))]
    pub id_token: Option<String>,
    #[serde(rename = "refresh_token", skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub refresh_material: Option<SealedRefreshMaterial>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub access_token_expires_at: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[builder(default, setter(strip_option))]
    pub metadata_redemption_id: Option<MetadataRedemptionId>,
}

impl AuthTokenDeltaRedirectFragment {
    pub fn from_delta(
        delta: &AuthTokenDelta,
        metadata_redemption_id: Option<MetadataRedemptionId>,
    ) -> Self {
        Self {
            access_token: delta.access_token.clone(),
            id_token: delta.id_token.clone(),
            refresh_material: delta.refresh_material.clone(),
            access_token_expires_at: delta.access_token_expires_at,
            metadata_redemption_id,
        }
    }

    pub fn to_fragment(&self) -> String {
        let mut fragment = form_urlencoded::Serializer::new(String::new());

        fragment.append_pair("access_token", &self.access_token);

        if let Some(refresh_material) = self.refresh_material.as_ref() {
            fragment.append_pair("refresh_token", refresh_material.expose());
        }

        if let Some(id_token) = self.id_token.as_deref() {
            fragment.append_pair("id_token", id_token);
        }

        if let Some(access_token_expiration) = self.access_token_expires_at.as_ref() {
            fragment.append_pair("expires_at", &access_token_expiration.to_rfc3339());
        }

        if let Some(metadata_redemption_id) = self.metadata_redemption_id.as_ref() {
            fragment.append_pair("metadata_redemption_id", metadata_redemption_id.expose());
        }

        fragment.finish()
    }
}
