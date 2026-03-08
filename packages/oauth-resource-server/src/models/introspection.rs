use chrono::{DateTime, Utc};
use oauth2::TokenIntrospectionResponse;
use openidconnect::core::CoreTokenIntrospectionResponse;

use crate::models::OAuthResourceServerMetadata;

#[derive(Debug, Clone)]
pub struct VerifiedOpaqueToken {
    pub response: CoreTokenIntrospectionResponse,
    pub metadata: OAuthResourceServerMetadata,
}

impl VerifiedOpaqueToken {
    pub fn active(&self) -> bool {
        self.response.active()
    }

    pub fn subject(&self) -> Option<&str> {
        self.response.sub()
    }

    pub fn issuer(&self) -> Option<&str> {
        self.response.iss()
    }

    pub fn audience(&self) -> Option<&Vec<String>> {
        self.response.aud()
    }

    pub fn expires_at(&self) -> Option<DateTime<Utc>> {
        self.response.exp()
    }
}
