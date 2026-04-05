// ---------------------------------------------------------------------------
// Unified backend-oidc transport / contract vocabulary
// ---------------------------------------------------------------------------

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use typed_builder::TypedBuilder;
use url::form_urlencoded;

use super::{
    metadata_redemption::{MetadataRedemptionId, PendingAuthStateMetadataRedemptionPayload},
    refresh_material::SealedRefreshMaterial,
};
use crate::models::{AuthTokenDelta, AuthTokenSnapshot, CurrentAuthStateMetadataSnapshotPartial};

// ---------------------------------------------------------------------------
// Authorize query
// ---------------------------------------------------------------------------

/// Query parameters for the unified backend-oidc login endpoint.
///
/// When `post_auth_redirect_policy = resolved`, the service resolves and
/// validates the supplied URI. When `caller_validated`, the service passes
/// the URI through without policy checks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct BackendOidcModeAuthorizeQuery {
    #[serde(default)]
    pub post_auth_redirect_uri: Option<String>,
}

// ---------------------------------------------------------------------------
// Refresh payload
// ---------------------------------------------------------------------------

/// Unified refresh payload for the backend-oidc refresh endpoint.
///
/// - `refresh_material`: either a plain refresh token (passthrough preset) or a
///   sealed blob (sealed preset).
/// - `post_auth_redirect_uri`, `id_token`, `current_metadata_snapshot`:
///   optional fields consumed by specific capability axes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackendOidcModeRefreshPayload {
    #[serde(rename = "refresh_token")]
    pub refresh_material: SealedRefreshMaterial,
    #[serde(
        rename = "post_auth_redirect_uri",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub post_auth_redirect_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_metadata_snapshot: Option<CurrentAuthStateMetadataSnapshotPartial>,
}

// ---------------------------------------------------------------------------
// Callback fragment
// ---------------------------------------------------------------------------

/// Browser-facing callback redirect fragment for the unified backend-oidc mode.
///
/// `id_token` is always present in a callback (authorization code flow always
/// yields an ID token). `metadata_redemption_id` is present only when the
/// `metadata_delivery = redemption` capability is active.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct BackendOidcModeCallbackFragment {
    #[builder(setter(into))]
    pub access_token: String,
    #[builder(default, setter(into))]
    pub id_token: String,
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

impl BackendOidcModeCallbackFragment {
    /// Build from an auth-token snapshot with an optional metadata redemption
    /// id (present only when `metadata_delivery = redemption`).
    pub fn from_snapshot(
        snapshot: &AuthTokenSnapshot,
        metadata_redemption_id: Option<MetadataRedemptionId>,
    ) -> Self {
        Self {
            access_token: snapshot.access_token.clone(),
            id_token: snapshot.id_token.clone(),
            refresh_material: snapshot.refresh_material.clone(),
            access_token_expires_at: snapshot.access_token_expires_at,
            metadata_redemption_id,
        }
    }

    /// Serialize the callback fragment into a URL-encoded query-string.
    ///
    /// The result is suitable for use as `url.set_fragment(Some(&qs))`.
    pub fn to_fragment_query_string(&self) -> String {
        let mut s = form_urlencoded::Serializer::new(String::new());
        s.append_pair("access_token", &self.access_token);
        s.append_pair("id_token", &self.id_token);
        if let Some(ref rm) = self.refresh_material {
            s.append_pair("refresh_token", rm.expose());
        }
        if let Some(ref expires) = self.access_token_expires_at {
            s.append_pair("expires_at", &expires.to_rfc3339());
        }
        if let Some(ref mrid) = self.metadata_redemption_id {
            s.append_pair("metadata_redemption_id", mrid.expose());
        }
        s.finish()
    }
}

// ---------------------------------------------------------------------------
// Refresh fragment
// ---------------------------------------------------------------------------

/// Browser-facing refresh redirect fragment for the unified backend-oidc mode.
///
/// `id_token` is optional because a refresh may or may not yield a new one.
/// `metadata_redemption_id` is present only when metadata delivery is active
/// and the refresh produced a metadata delta worth persisting.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TypedBuilder)]
pub struct BackendOidcModeRefreshFragment {
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

impl BackendOidcModeRefreshFragment {
    /// Build from an auth-token delta with an optional metadata redemption id.
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

    /// Serialize the refresh fragment into a URL-encoded query-string.
    pub fn to_fragment_query_string(&self) -> String {
        let mut s = form_urlencoded::Serializer::new(String::new());
        s.append_pair("access_token", &self.access_token);
        if let Some(ref id_token) = self.id_token {
            s.append_pair("id_token", id_token);
        }
        if let Some(ref rm) = self.refresh_material {
            s.append_pair("refresh_token", rm.expose());
        }
        if let Some(ref expires) = self.access_token_expires_at {
            s.append_pair("expires_at", &expires.to_rfc3339());
        }
        if let Some(ref mrid) = self.metadata_redemption_id {
            s.append_pair("metadata_redemption_id", mrid.expose());
        }
        s.finish()
    }
}

// ---------------------------------------------------------------------------
// Metadata redemption contract (capability: metadata_delivery = redemption)
// ---------------------------------------------------------------------------

/// Request to redeem metadata by one-time redemption id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackendOidcModeMetadataRedemptionRequest {
    pub metadata_redemption_id: MetadataRedemptionId,
}

/// Response from a metadata redemption request.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackendOidcModeMetadataRedemptionResponse {
    pub metadata: PendingAuthStateMetadataRedemptionPayload,
}

// ---------------------------------------------------------------------------
// User info exchange contract
// ---------------------------------------------------------------------------

/// Request body for the unified backend-oidc `user_info` endpoint.
///
/// `id_token` is submitted in the request body. The `access_token` is
/// submitted as a bearer token in the `Authorization` header.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackendOidcModeUserInfoRequest {
    pub id_token: String,
}

/// Normalized user info response.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BackendOidcModeUserInfoResponse {
    pub subject: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claims: Option<HashMap<String, serde_json::Value>>,
}
