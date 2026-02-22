use chrono::{DateTime, Utc};
use securitydept_creds::{Argon2BasicAuthCred, Sha256TokenAuthCred};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// The kind of authentication entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthEntryKind {
    Basic,
    Token,
}

/// An authentication entry (basic auth or token auth).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthEntryMeta {
    pub id: String,
    pub name: String,
    /// Group IDs this entry belongs to.
    #[serde(default)]
    pub group_ids: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BasicAuthEntry {
    pub cred: Argon2BasicAuthCred,
    pub meta: AuthEntryMeta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenAuthEntry {
    pub cred: Sha256TokenAuthCred,
    pub meta: AuthEntryMeta,
}

impl AuthEntryMeta {
    pub fn new(name: String, group_ids: Vec<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name: name.clone(),
            group_ids,
            created_at: now,
            updated_at: now,
        }
    }
}

/// A named group that auth entries can belong to.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    pub id: String,
    pub name: String,
}

impl Group {
    pub fn new(name: String) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            name,
        }
    }
}

/// Top-level data structure persisted to the data file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DataFile {
    pub entries: Vec<AuthEntryMeta>,
    pub groups: Vec<Group>,
    pub basic: Vec<AuthEntryMeta>,
    pub token: Vec<AuthEntryMeta>,
}

/// Session info stored in memory after OIDC login.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub claims: serde_json::Value,
    pub expires_at: DateTime<Utc>,
}

/// Request payload for creating a basic auth entry.
#[derive(Debug, Deserialize)]
pub struct CreateBasicEntryRequest {
    pub name: String,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub group_ids: Vec<String>,
}

/// Request payload for creating a token auth entry.
#[derive(Debug, Deserialize)]
pub struct CreateTokenEntryRequest {
    pub name: String,
    #[serde(default)]
    pub group_ids: Vec<String>,
}

/// Response after creating a token auth entry (includes the plaintext token once).
#[derive(Debug, Serialize)]
pub struct CreateTokenEntryResponse {
    pub entry: AuthEntryMeta,
    pub token: String,
}

/// Request payload for updating an auth entry.
#[derive(Debug, Deserialize)]
pub struct UpdateEntryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_ids: Option<Vec<String>>,
}

/// Request payload for creating a group.
#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_ids: Option<Vec<String>>,
}

/// Request payload for updating a group.
#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_ids: Option<Vec<String>>,
}

/// Info about the currently logged-in user.
#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub display_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
    pub claims: serde_json::Value,
}
