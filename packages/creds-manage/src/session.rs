use std::collections::HashMap;
use std::sync::Arc;

use chrono::{Duration, Utc};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::Session;

/// In-memory session store with expiration.
#[derive(Clone)]
pub struct SessionManager {
    sessions: Arc<RwLock<HashMap<String, Session>>>,
    /// Session TTL in seconds.
    ttl_seconds: i64,
}

impl SessionManager {
    pub fn new(ttl_seconds: i64) -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            ttl_seconds,
        }
    }

    /// Create a new session and return its ID.
    pub async fn create(
        &self,
        display_name: String,
        picture: Option<String>,
        claims: serde_json::Value,
    ) -> String {
        let session_id = Uuid::new_v4().to_string();
        let session = Session {
            session_id: session_id.clone(),
            display_name,
            picture,
            claims,
            expires_at: Utc::now() + Duration::seconds(self.ttl_seconds),
        };

        let mut sessions = self.sessions.write().await;
        sessions.insert(session_id.clone(), session);
        session_id
    }

    /// Get a session by ID, returning None if expired or not found.
    pub async fn get(&self, session_id: &str) -> Option<Session> {
        let sessions = self.sessions.read().await;
        sessions.get(session_id).and_then(|s| {
            if s.expires_at > Utc::now() {
                Some(s.clone())
            } else {
                None
            }
        })
    }

    /// Remove a session.
    pub async fn remove(&self, session_id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.remove(session_id);
    }

    /// Purge all expired sessions.
    pub async fn cleanup(&self) {
        let mut sessions = self.sessions.write().await;
        let now = Utc::now();
        sessions.retain(|_, s| s.expires_at > now);
    }
}
