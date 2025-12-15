use chrono::{DateTime, Utc};
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
pub struct AuthEntry {
    pub id: String,
    pub name: String,
    pub kind: AuthEntryKind,
    /// Username for basic auth entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    /// Argon2 hash of the password for basic auth entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_hash: Option<String>,
    /// SHA-256 hash of the token for token auth entries.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_hash: Option<String>,
    /// Groups this entry belongs to.
    pub groups: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl AuthEntry {
    pub fn new_basic(name: String, username: String, password_hash: String, groups: Vec<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            kind: AuthEntryKind::Basic,
            username: Some(username),
            password_hash: Some(password_hash),
            token_hash: None,
            groups,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn new_token(name: String, token_hash: String, groups: Vec<String>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            name,
            kind: AuthEntryKind::Token,
            username: None,
            password_hash: None,
            token_hash: Some(token_hash),
            groups,
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
    pub entries: Vec<AuthEntry>,
    pub groups: Vec<Group>,
}

/// Session info stored in memory after OIDC login.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub session_id: String,
    pub display_name: String,
    pub claims: serde_json::Value,
    pub expires_at: DateTime<Utc>,
}

/// Request payload for creating a basic auth entry.
#[derive(Debug, Deserialize)]
pub struct CreateBasicEntryRequest {
    pub name: String,
    pub username: String,
    pub password: String,
    pub groups: Vec<String>,
}

/// Request payload for creating a token auth entry.
#[derive(Debug, Deserialize)]
pub struct CreateTokenEntryRequest {
    pub name: String,
    pub groups: Vec<String>,
}

/// Response after creating a token auth entry (includes the plaintext token once).
#[derive(Debug, Serialize)]
pub struct CreateTokenEntryResponse {
    pub entry: AuthEntry,
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
    pub groups: Option<Vec<String>>,
}

/// Request payload for creating a group.
#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
}

/// Request payload for updating a group.
#[derive(Debug, Deserialize)]
pub struct UpdateGroupRequest {
    pub name: String,
}

/// Result of OIDC claims check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaimsCheckResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claims: Option<serde_json::Value>,
}

/// Info about the currently logged-in user.
#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub display_name: String,
    pub claims: serde_json::Value,
}
